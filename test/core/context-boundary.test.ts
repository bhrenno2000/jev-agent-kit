import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectContext } from "../../src/context.js";

function clientFor(score: number, calls: { count: number }) {
  return {
    evaluate: async (input: { questions: Record<string, unknown> }) => {
      calls.count += 1;
      return {
        model: "test",
        usage: { input_tokens: 1, output_tokens: 1 },
        answers: Object.fromEntries(
          Object.keys(input.questions).map((id) => [id, { type: "noul", noul: score }]),
        ),
      };
    },
  } as never;
}

test("context preserves UTF-8 content and reports bounded output", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-context-boundary-"));
  const content = "const greeting = 'olá 世界';\n";
  await writeFile(join(root, "unicode.ts"), content, "utf8");
  const calls = { count: 0 };
  const result = await collectContext(clientFor(0.9, calls), root, {
    query: "x".repeat(4096),
    paths: ["unicode.ts"],
    chunkBytes: 512,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= 16 * 1024);
  const selected = result.selected as Array<{ content: string; digest: string }>;
  assert.equal(selected[0]?.content, content);
  assert.equal(selected[0]?.digest, createHash("sha256").update(content).digest("hex"));
  assert.equal(calls.count, 1);
});

test("context batches at most six chunks and does not grow calls for low scores", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-context-batch-"));
  await writeFile(
    join(root, "many.ts"),
    Array.from({ length: 30 }, (_, index) => `line ${index} ${"x".repeat(450)}`).join("\n"),
    "utf8",
  );
  const calls = { count: 0 };
  const result = await collectContext(clientFor(0.1, calls), root, {
    query: "line",
    paths: ["many.ts"],
    chunkBytes: 512,
    maxChunks: 24,
  });
  assert.equal((result.selected as unknown[]).length, 0);
  assert.equal((result.counts as { evaluatedChunks: number }).evaluatedChunks, 24);
  assert.equal(calls.count, 4);
});

test("context rejects an already aborted request before filesystem work", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-context-abort-"));
  const controller = new AbortController();
  controller.abort();
  const calls = { count: 0 };
  await assert.rejects(
    collectContext(
      clientFor(0.9, calls),
      root,
      { query: "x", paths: ["missing.ts"] },
      controller.signal,
    ),
  );
  assert.equal(calls.count, 0);
});

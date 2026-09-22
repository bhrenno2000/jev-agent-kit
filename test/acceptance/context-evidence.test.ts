import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectContext } from "../../src/context.js";

type ChunkInput = { path: string; startLine: number; endLine: number; content: string };

function fakeClient(score: (chunk: ChunkInput) => number, calls: ChunkInput[][] = []) {
  return {
    calls,
    evaluate: async (input: { state: { chunks: ChunkInput[] } }) => {
      calls.push(input.state.chunks);
      return {
        model: "test",
        usage: { input_tokens: 1, output_tokens: 1 },
        answers: Object.fromEntries(
          input.state.chunks.map((chunk, index) => [
            `chunk_${index}`,
            { type: "noul", noul: score(chunk) },
          ]),
        ),
      };
    },
  };
}

function coverage(result: Record<string, unknown>) {
  return result.coverage as {
    evaluatedChunks: number;
    returnedChunks: number;
    filteredChunks: number;
    budgetOmittedChunks: number;
    unscannedChunks: number;
    skippedFiles: number;
    recoveryRefsOmitted: number;
  };
}

test("low relevance is an incomplete result with recoverable evidence references", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-context-evidence-low-"));
  await writeFile(join(root, "source.ts"), "export const unrelated = true;\n");
  const client = fakeClient(() => 0.1);
  const result = await collectContext(client as never, root, {
    query: "missing query",
    paths: ["source.ts"],
  });
  const counts = coverage(result);
  assert.equal((result.selected as unknown[]).length, 0);
  assert.equal(result.incomplete, true);
  assert.equal(counts.evaluatedChunks, 1);
  assert.equal(counts.returnedChunks, 0);
  assert.equal(counts.filteredChunks, 1);
  assert.equal(counts.budgetOmittedChunks, 0);
  assert.equal(counts.unscannedChunks, 0);
  assert.equal(counts.skippedFiles, 0);
  assert.equal(counts.recoveryRefsOmitted, 0);
  const refs = result.recoveryRefs as Array<{
    path: string;
    startLine: number;
    endLine: number;
    digest: string;
    score: number;
    reason: string;
  }>;
  assert.equal(refs.length, 1);
  assert.equal(refs[0]!.path, "source.ts");
  assert.equal(refs[0]!.startLine, 1);
  assert.equal(refs[0]!.endLine, 2);
  assert.equal(refs[0]!.score, 0.1);
  assert.equal(refs[0]!.reason, "low_relevance");
  assert.match(refs[0]!.digest, /^[a-f0-9]{64}$/);
});

test("uncertain relevance at .25 is retained", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-context-evidence-uncertain-"));
  await writeFile(join(root, "source.ts"), "export const maybe = true;\n");
  const result = await collectContext(fakeClient(() => 0.25) as never, root, {
    query: "maybe",
    paths: ["source.ts"],
  });
  const selected = result.selected as Array<{ score: number; uncertain: boolean }>;
  assert.equal(selected.length, 1);
  assert.equal(selected[0]!.score, 0.25);
  assert.equal(selected[0]!.uncertain, true);
  assert.equal(result.incomplete, false);
  assert.equal(coverage(result).filteredChunks, 0);
});

test("output cap omits lowest scores and accounts for recovery references", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-context-evidence-budget-"));
  const lines = Array.from(
    { length: 24 },
    (_, index) => `${String(index).padStart(2, "0")} ${"x".repeat(495)}`,
  );
  await writeFile(join(root, "large.ts"), `${lines.join("\n")}\n`);
  const result = await collectContext(
    fakeClient((chunk) => 0.9 - (chunk.startLine - 1) / 100) as never,
    root,
    { query: "x", paths: ["large.ts"], chunkBytes: 512, maxChunks: 24 },
  );
  const counts = coverage(result);
  assert.ok(counts.budgetOmittedChunks > 0);
  assert.equal(result.incomplete, true);
  assert.equal(
    counts.returnedChunks + counts.filteredChunks + counts.budgetOmittedChunks,
    counts.evaluatedChunks,
  );
  const refs = result.recoveryRefs as Array<{ score: number; reason: string }>;
  assert.equal(
    refs.length + counts.recoveryRefsOmitted,
    counts.filteredChunks + counts.budgetOmittedChunks,
  );
  assert.ok(refs.every((ref) => ref.reason === "output_budget" || ref.reason === "low_relevance"));
  assert.ok(refs.every((ref, index, all) => index === 0 || ref.score <= all[index - 1]!.score));
});

test("duplicate paths are evaluated once", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-context-evidence-duplicate-"));
  await writeFile(join(root, "source.ts"), "export const value = 1;\n");
  const client = fakeClient(() => 0.8);
  const result = await collectContext(client as never, root, {
    query: "value",
    paths: ["source.ts", "source.ts"],
  });
  assert.equal(client.calls.length, 1);
  assert.equal(coverage(result).evaluatedChunks, 1);
  assert.equal((result.selected as unknown[]).length, 1);
});

test("a small chunk budget evaluates more than the first file", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-context-evidence-round-robin-"));
  await writeFile(join(root, "first.ts"), "export const first = true;\n");
  await writeFile(join(root, "second.ts"), "export const second = true;\n");
  const result = await collectContext(fakeClient(() => 0.8) as never, root, {
    query: "value",
    paths: ["first.ts", "second.ts"],
    maxChunks: 2,
  });
  const selected = result.selected as Array<{ path: string }>;
  assert.deepEqual(
    new Set(selected.map((chunk) => chunk.path)),
    new Set(["first.ts", "second.ts"]),
  );
  assert.equal(coverage(result).evaluatedChunks, 2);
});

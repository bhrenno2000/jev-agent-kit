import assert from "node:assert/strict";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectContext } from "../../src/context.js";

test("context rejects traversal and reports skipped files", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-context-"));
  await writeFile(join(root, "source.ts"), "export const value = 1;\n");
  await writeFile(join(root, ".env"), "TYPESAFE_API_KEY=secret\n");
  await symlink(join(root, "source.ts"), join(root, "link.ts"));
  const calls: unknown[] = [];
  const client = {
    evaluate: async (input: unknown) => {
      calls.push(input);
      return {
        model: "test",
        usage: { input_tokens: 1, output_tokens: 0 },
        answers: { chunk_0: { type: "noul", noul: 0.8 } },
      };
    },
  } as never;
  const result = await collectContext(client, root, {
    query: "value",
    paths: ["source.ts", ".env", "link.ts", "../outside.ts"],
  });
  assert.equal((result.selected as unknown[]).length, 1);
  assert.equal(calls.length, 1);
  assert.equal(
    (result.files as Array<{ status: string }>).filter((item) => item.status === "skipped").length,
    3,
  );
  assert.equal(result.incomplete, true);
});

test("context does not convert provider failure into absence", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-context-failure-"));
  await writeFile(join(root, "source.ts"), "export const value = 1;\n");
  const client = {
    evaluate: async () => {
      throw new Error("provider unavailable");
    },
  } as never;
  await assert.rejects(() =>
    collectContext(client, root, { query: "value", paths: ["source.ts"] }),
  );
});

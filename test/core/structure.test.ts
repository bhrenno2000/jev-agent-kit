import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectStructure } from "../../src/structure.js";

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "jev-structure-"));
  await mkdir(join(root, "src"), { recursive: true });
  return root;
}

test("preserves leading source documentation and marks computed imports incomplete", async (t) => {
  const root = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "src/app.ts"),
    "/** The caller owns the transaction. */\nexport function target(path: string) { return import(path); }\n",
  );
  const result = await collectStructure(root, { query: "target", paths: ["src/app.ts"] });
  const block = result.selected.find((item) => item.symbols.includes("target"));
  assert.ok(block?.content.includes("The caller owns the transaction"));
  assert.equal(block?.startLine, 1);
  assert.equal(result.incomplete, true);
  assert.equal(result.coverage.unresolvedDependencies, 1);
});

test("returns a complete declaration far down the file", async (t) => {
  const root = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const lines = Array.from(
    { length: 40 },
    (_, index) => `export const filler${index} = ${index};`,
  ).join("\n");
  await writeFile(
    join(root, "src/app.ts"),
    `${lines}\nexport function needleFunction(value: number) {\n  return value + 1;\n}\n`,
  );
  const result = await collectStructure(root, { query: "needleFunction", paths: ["src/app.ts"] });
  const block = result.selected.find((item) => item.symbols.includes("needleFunction"));
  assert.ok(block);
  assert.equal(block.exactMatch, true);
  assert.match(block.content, /return value \+ 1/);
  assert.equal(block.startLine, 41);
  assert.equal(block.endLine, 43);
  assert.equal(result.incomplete, false);
});

test("follows local imports and reports dependency provenance", async (t) => {
  const root = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "src/app.mjs"),
    'import { helper } from "./helper.mjs";\nexport function run() { return helper(); }\n',
  );
  await writeFile(join(root, "src/helper.mjs"), "export function helper() { return 7; }\n");
  const result = await collectStructure(root, { query: "helper", paths: ["src/app.mjs"] });
  assert.deepEqual(
    result.sources.map((source) => source.path),
    ["src/app.mjs", "src/helper.mjs"],
  );
  assert.equal(result.sources[0]?.dependencies[0], "src/helper.mjs");
  assert.ok(
    result.selected.some(
      (item) => item.path === "src/helper.mjs" && item.symbols.includes("helper"),
    ),
  );
  assert.ok(
    result.selected.some(
      (item) => item.kind === "import" && item.dependencies.includes("./helper.mjs"),
    ),
  );
});

test("resolves runtime extensions and re-export edges", async (t) => {
  const root = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "src/index.js"), 'export { helper } from "./helper.js";\n');
  await writeFile(join(root, "src/helper.ts"), "export const helper = 1;\n");
  const result = await collectStructure(root, { query: "helper", paths: ["src/index.js"] });
  assert.ok(result.sources.some((source) => source.path === "src/helper.ts"));
  assert.ok(
    result.selected.some(
      (item) => item.path === "src/index.js" && item.dependencies.includes("./helper.js"),
    ),
  );
});

test("records missing and unsupported dependency edges and uses TS parsing", async (t) => {
  const root = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "src/app.ts"),
    'const value = <number>1;\nimport("./missing.mjs");\nrequire("external-package");\n',
  );
  const result = await collectStructure(root, { query: "value", paths: ["src/app.ts"] });
  assert.equal(result.sources[0]?.syntaxErrors, 0);
  assert.ok(result.sources[0]?.unresolvedDependencies.includes("./missing.mjs"));
  assert.ok(result.sources[0]?.unresolvedDependencies.includes("external-package"));
  assert.equal(result.incomplete, true);
});

test("bounds a declaration-heavy response and counts omitted blocks", async (t) => {
  const root = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "src/many.ts"),
    Array.from({ length: 3000 }, (_, index) => `export const item${index} = ${index};`).join("\n"),
  );
  const result = await collectStructure(root, {
    query: "item",
    paths: ["src/many.ts"],
    maxBytes: 24000,
  });
  assert.ok(result.coverage.omittedBlocks > 0);
  assert.ok(JSON.stringify(result).length <= 65536);
});

test("keeps syntax errors bounded and skips unsupported sources", async (t) => {
  const root = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "src/bad.ts"), "export function broken( { return 1;\n");
  await writeFile(join(root, "src/data.bin"), "not source");
  const result = await collectStructure(root, {
    query: "broken",
    paths: ["src/bad.ts", "src/data.bin"],
  });
  assert.equal(result.coverage.scannedFiles, 1);
  assert.ok(result.sources.some((item) => item.path === "src/bad.ts"));
  assert.equal(result.incomplete, true);
  assert.ok(
    result.skipped.some(
      (item) => item.path === "src/data.bin" && item.reason === "unsupported source",
    ),
  );
});

test("omits complete low priority blocks with recoverable references", async (t) => {
  const root = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "src/budget.ts"),
    "export const first = 'first';\nexport function target() { return 'target'; }\n",
  );
  const result = await collectStructure(root, {
    query: "target",
    paths: ["src/budget.ts"],
    maxBytes: 50,
  });
  assert.ok(result.selected.some((item) => item.symbols.includes("target")));
  assert.ok(result.recoveryRefs.some((item) => item.path === "src/budget.ts"));
  assert.ok(
    result.recoveryRefs.every(
      (item) => item.startLine <= item.endLine && item.reason === "output_budget",
    ),
  );
  assert.equal(result.coverage.omittedBlocks, result.recoveryRefs.length);
  assert.equal(result.incomplete, true);
  for (const item of result.selected)
    assert.equal(
      item.content.trim(),
      (await readFile(join(root, item.path), "utf8"))
        .split("\n")
        .slice(item.startLine - 1, item.endLine)
        .join("\n")
        .trim(),
    );
});

test("rejects symlinks, escape paths, and sensitive files", async (t) => {
  const root = await workspace();
  const outside = await mkdtemp(join(tmpdir(), "jev-outside-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await writeFile(join(outside, "outside.ts"), "export const outside = true;\n");
  await symlink(join(outside, "outside.ts"), join(root, "src/link.ts"));
  await writeFile(join(root, "src/.env.mjs"), "export const secret = true;\n");
  const result = await collectStructure(root, {
    query: "outside",
    paths: ["src/link.ts", "../outside.ts", "src/.env.mjs"],
  });
  assert.equal(result.selected.length, 0);
  assert.ok(
    result.skipped.some((item) => item.path === "src/link.ts" && item.reason.includes("symbolic")),
  );
  assert.ok(
    result.skipped.some((item) => item.path === "../outside.ts" && item.reason.includes("outside")),
  );
  assert.ok(
    result.skipped.some((item) => item.path === "src/.env.mjs" && item.reason === "sensitive path"),
  );
  assert.equal(result.incomplete, true);
});

test("observes file changes between snapshots without stale cached content", async (t) => {
  const root = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "src/change.ts");
  await writeFile(path, "export const state = 'before';\n");
  const before = await collectStructure(root, { query: "state", paths: ["src/change.ts"] });
  await writeFile(path, "export const state = 'after';\n");
  const after = await collectStructure(root, { query: "state", paths: ["src/change.ts"] });
  assert.notEqual(before.snapshot, after.snapshot);
  assert.match(after.selected[0]?.content ?? "", /after/);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const loadModule = new Function("path", "return import(path)") as (path: string) => Promise<{
  buildEvidence: (root: string) => Promise<any>;
}>;
const { buildEvidence } = await loadModule(
  pathToFileURL(new URL("../../scripts/verification-server.mjs", import.meta.url).pathname).href,
);

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "jev-verification-evidence-"));
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
  return root;
}

const contract = JSON.stringify({
  claims: [
    { id: "claim-one", statement: "The first property holds." },
    { id: "claim-two", statement: "The second property holds." },
    { id: "claim-three", statement: "The third property holds." },
    { id: "claim-four", statement: "The fourth property holds." },
  ],
});

test("buildEvidence includes nested source and preserves neutral claims and provenance", async () => {
  const root = await fixture({
    "verification-contract.json": contract,
    "task.txt": "Review the supplied implementation.",
    "src/index.mjs": "export const root = 1;\n",
    "src/nested/cache.mjs": "export const nested = 2;\n",
  });
  try {
    const evidence = await buildEvidence(root);
    assert.equal(evidence.provenance.length, 2);
    assert.deepEqual(
      evidence.provenance.map((item: { path: string }) => item.path),
      ["src/index.mjs", "src/nested/cache.mjs"],
    );
    const source = "export const root = 1;\n";
    assert.equal(evidence.provenance[0].sha256, createHash("sha256").update(source).digest("hex"));
    assert.deepEqual(Object.keys(evidence.input.questions).sort(), [
      "claim-four",
      "claim-one",
      "claim-three",
      "claim-two",
    ]);
    assert.equal(JSON.stringify(evidence.input).includes("expectedCandidate"), false);
    assert.equal(evidence.input.state.includes("src/nested/cache.mjs"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildEvidence rejects oversized source before provider access", async () => {
  const root = await fixture({
    "verification-contract.json": contract,
    "task.txt": "Review the supplied implementation.",
    "src/large.mjs": "x".repeat(16385),
  });
  try {
    await assert.rejects(
      () => buildEvidence(root),
      /Source limit exceeded|Evidence limit exceeded/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildEvidence rejects symlinked source and does not read outside the fixture", async () => {
  const root = await fixture({
    "verification-contract.json": contract,
    "task.txt": "Review the supplied implementation.",
    "src/index.mjs": "export const safe = true;\n",
  });
  const outside = await mkdtemp(join(tmpdir(), "jev-verification-outside-"));
  try {
    const outsideFile = join(outside, "outside.mjs");
    await writeFile(outsideFile, "export const secret = true;\n");
    await symlink(outsideFile, join(root, "src", "linked.mjs"));
    await assert.rejects(() => buildEvidence(root), /Symbolic links are not allowed/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

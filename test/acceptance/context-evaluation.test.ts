import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runContextEvaluation,
  scoreContextObservation,
  validateContextFixtures,
} from "../../scripts/context-evaluation.js";

test("context evaluation fixture validates authored paths and evidence ranges", async () => {
  const fixture = await validateContextFixtures();
  assert.equal(fixture.cases.length, 5);
  assert.equal(new Set(fixture.cases.map((item) => item.id)).size, 5);
  assert.ok(fixture.cases.every((item) => item.expected.length > 0 && item.rationale.length > 0));
});

test("context metrics count line evidence separately from file precision", () => {
  const fixture = {
    id: "case",
    query: "query",
    paths: ["src/a.ts", "src/b.ts"],
    expected: [
      { path: "src/a.ts", startLine: 1, endLine: 2 },
      { path: "src/b.ts", startLine: 5, endLine: 6 },
    ],
    rationale: "fixture",
  };
  const quality = scoreContextObservation(fixture, {
    selected: [
      { path: "src/a.ts", startLine: 2, endLine: 3 },
      { path: "src/distractor.ts", startLine: 1, endLine: 2 },
    ],
    recoveryRefs: [{ path: "src/b.ts", startLine: 5, endLine: 6 }],
  });
  assert.deepEqual(quality, {
    evidenceRecall: 0.25,
    filePrecision: 0.5,
    withheldRecoverability: 2 / 3,
  });
});

test("context metrics union adjacent selected ranges and count partial lines", () => {
  const fixture = {
    id: "ranges",
    query: "query",
    paths: ["src/a.ts"],
    expected: [{ path: "src/a.ts", startLine: 1, endLine: 4 }],
    rationale: "fixture",
  };
  assert.deepEqual(
    scoreContextObservation(fixture, {
      selected: [
        { path: "src/a.ts", startLine: 1, endLine: 2 },
        { path: "src/a.ts", startLine: 3, endLine: 4 },
      ],
    }),
    { evidenceRecall: 1, filePrecision: 1, withheldRecoverability: null },
  );
  assert.deepEqual(
    scoreContextObservation(fixture, {
      selected: [{ path: "src/a.ts", startLine: 2, endLine: 2 }],
      recoveryRefs: [{ path: "src/a.ts", startLine: 4, endLine: 4 }],
    }),
    { evidenceRecall: 0.25, filePrecision: 1, withheldRecoverability: 1 / 3 },
  );
});

test("context metrics return zero recall for valid empty selection", () => {
  const fixture = {
    id: "empty",
    query: "query",
    paths: ["src/a.ts"],
    expected: [{ path: "src/a.ts", startLine: 1, endLine: 2 }],
    rationale: "fixture",
  };
  assert.deepEqual(scoreContextObservation(fixture, { selected: [], recoveryRefs: [] }), {
    evidenceRecall: 0,
    filePrecision: null,
    withheldRecoverability: 0,
  });
});

test("context metrics return full recall and no withheld denominator when all evidence returns", () => {
  const fixture = {
    id: "full",
    query: "query",
    paths: ["src/a.ts"],
    expected: [{ path: "src/a.ts", startLine: 1, endLine: 2 }],
    rationale: "fixture",
  };
  assert.deepEqual(
    scoreContextObservation(fixture, {
      selected: [{ path: "src/a.ts", startLine: 1, endLine: 2 }],
    }),
    { evidenceRecall: 1, filePrecision: 1, withheldRecoverability: null },
  );
});

test("malformed and failed CLI results retain null quality", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "jev-context-invalid-cli-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const binary = join(directory, "fake-cli.mjs");
  for (const response of ["{}", "not JSON", "failure"]) {
    await writeFile(
      binary,
      response === "failure"
        ? "process.stdin.resume(); process.stdin.on('end', () => { process.stderr.write('synthetic failure'); process.exitCode = 1; });"
        : `process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(${JSON.stringify(response)}));`,
    );
    const result = await runContextEvaluation(binary, { encode: (value) => [...value] });
    assert.equal(result.errors, 5);
    assert.ok(
      result.observations.every((row) => row.quality === null && row.providerUsage === null),
    );
    assert.ok(result.observations.every((row) => row.error));
  }
});

test("split-function fixture crosses the chunk budget without an oversized line", async () => {
  const fixture = await validateContextFixtures();
  const split = fixture.cases.find((item) => item.id === "split-function-boundary")!;
  const content = await readFile("fixtures/context-evaluation/src/validation.ts", "utf8");
  assert.ok(Buffer.byteLength(content) > split.chunkBytes!);
  assert.ok(content.split("\n").every((line) => Buffer.byteLength(line) <= split.chunkBytes!));
  const prefix = content
    .split("\n")
    .slice(0, split.expected[1]!.startLine - 1)
    .join("\n");
  assert.ok(Buffer.byteLength(prefix) > split.chunkBytes!);
});

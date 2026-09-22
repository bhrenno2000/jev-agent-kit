import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);

test("verification summary retains missing, failed, and valid paired outcomes", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-verification-summary-"));
  const report = join(root, "report.json");
  const capability = join(root, "capability.json");
  const output = join(root, "summary");
  const usage = [
    { input_tokens: 80, cached_input_tokens: 20, output_tokens: 10 },
    { input_tokens: 20, cached_input_tokens: 5, output_tokens: 5 },
  ];
  const trial = (
    name: string,
    arm: string,
    variant: string,
    repeat: number,
    overrides: Record<string, unknown> = {},
  ) => ({
    name,
    level: "low",
    variant,
    arm,
    repeat,
    acceptance: { passed: true },
    agentExitCode: 0,
    timedOut: false,
    telemetryValid: true,
    protocolCompliant: true,
    usageAvailable: true,
    providerUsageComplete: true,
    mainUsage: usage,
    jevCalls: [
      {
        status: "success",
        usage: { input_tokens: 10, output_tokens: 1 },
        providerMetadata: { gateway: { cost: "0" } },
        meta: { attempts: 1 },
      },
    ],
    ...overrides,
  });
  const plan = [
    { name: "candidate-baseline", level: "low", variant: "candidate", arm: "baseline", repeat: 1 },
    { name: "candidate-verified", level: "low", variant: "candidate", arm: "verified", repeat: 1 },
    { name: "reference-baseline", level: "low", variant: "reference", arm: "baseline", repeat: 1 },
    { name: "reference-verified", level: "low", variant: "reference", arm: "verified", repeat: 1 },
    { name: "medium-baseline", level: "medium", variant: "reference", arm: "baseline", repeat: 1 },
    { name: "medium-verified", level: "medium", variant: "reference", arm: "verified", repeat: 1 },
  ];
  await writeFile(
    report,
    JSON.stringify({
      status: "completed",
      plan,
      trials: [
        trial("candidate-baseline", "baseline", "candidate", 1, {
          jevCalls: [],
          sourceUnchanged: true,
          contractUnchanged: true,
        }),
        trial("candidate-verified", "verified", "candidate", 1, {
          acceptance: { passed: false },
          verifiedInitialSource: true,
          contractUnchanged: true,
        }),
        trial("reference-baseline", "baseline", "reference", 1, {
          timedOut: true,
          agentExitCode: null,
        }),
        trial("medium-baseline", "baseline", "reference", 1, {
          jevCalls: [],
          sourceUnchanged: true,
          contractUnchanged: true,
        }),
        trial("medium-verified", "verified", "reference", 1, {
          verifiedInitialSource: true,
          contractUnchanged: true,
        }),
      ],
    }),
  );
  await writeFile(
    capability,
    JSON.stringify({
      threshold: [0.2, 0.8],
      rows: [
        {
          level: "low",
          variant: "candidate",
          repeat: 1,
          expected: { bug: false, "neg-bug": true, good: true, "neg-good": false },
          verdicts: {
            bug: { probability: 0.9 },
            "neg-bug": { probability: 0.9 },
            good: { probability: 0.1 },
            "neg-good": { probability: 0.1 },
          },
        },
      ],
    }),
  );
  await execute(
    process.platform === "win32" ? "python" : "python3",
    [
      "scripts/summarize-verification.py",
      "--report",
      report,
      "--capability",
      capability,
      "--output",
      output,
    ],
    { cwd: process.cwd() },
  );
  const summary = JSON.parse(await readFile(join(output, "summary.json"), "utf8"));
  assert.equal(summary.plannedTrials, 6);
  assert.equal(summary.reportedTrials, 5);
  assert.equal(
    summary.trials.find((row: { name: string }) => row.name === "reference-verified").status,
    "missing",
  );
  const pair = summary.pairedComparisons.find(
    (row: { variant: string }) => row.variant === "candidate",
  );
  assert.equal(pair.qualityComparison, "verified_loss");
  assert.equal(pair.eligible, false);
  const eligiblePair = summary.pairedComparisons.find(
    (row: { variant: string; level: string }) =>
      row.variant === "reference" && row.level === "medium",
  );
  assert.equal(eligiblePair.eligible, true);
  assert.equal(summary.capability.falseApprovalOriginalPositiveClaimOnDefectiveInput, 1);
  assert.equal(summary.capability.positiveInverseContradictions.length, 2);
});

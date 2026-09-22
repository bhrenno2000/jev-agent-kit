import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);

test("optimization plan has counterbalanced 36 trials and three arms", async () => {
  const script = `
import importlib.util
spec = importlib.util.spec_from_file_location("optimization", "scripts/optimization-benchmark.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
plan = module.make_plan(2, ["low", "medium", "high"])
assert len(plan) == 36
assert {item["arm"] for item in plan} == {"native", "prepared", "jev"}
assert module.sum_field([{"input_tokens": 2}, {"input_tokens": 3}], "input_tokens") == 5
for invalid in [[{"input_tokens": True}], [{"input_tokens": -1}], [{"input_tokens": float("nan")}], [{"input_tokens": "2"}], [{}]]:
  assert module.sum_field(invalid, "input_tokens") is None
for repeat in [1, 2]:
  for level in ["low", "medium", "high"]:
    for variant in ["seed", "reference"]:
      rows = [item for item in plan if item["repeat"] == repeat and item["level"] == level and item["variant"] == variant]
      assert [item["arm"] for item in rows] == list(dict.fromkeys(item["arm"] for item in rows))
      assert {item["arm"] for item in rows} == {"native", "prepared", "jev"}
print("ok")
`;
  const result = await execute(
    process.platform === "win32" ? "python" : "python3",
    ["-c", script],
    { cwd: process.cwd() },
  );
  assert.equal(result.stdout.trim(), "ok");
});

test("optimization summary retains missing outcomes and compares both prepared arms", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-optimization-summary-"));
  const report = join(root, "report.json");
  const output = join(root, "summary");
  const plan = ["native", "prepared", "jev"].map((arm) => ({
    name: arm,
    level: "low",
    variant: "seed",
    arm,
    repeat: 1,
  }));
  const usage = [{ input_tokens: 100, cached_input_tokens: 50, output_tokens: 10 }];
  const trial = (name: string, arm: string, overrides: Record<string, unknown> = {}) => ({
    name,
    level: "low",
    variant: "seed",
    arm,
    repeat: 1,
    acceptance: { passed: true },
    agentExitCode: 0,
    timedOut: false,
    protocolCompliant: true,
    telemetryValid: true,
    contractUnchanged: true,
    usageAvailable: true,
    providerUsageComplete: true,
    mainUsage: usage,
    providerCalls:
      arm === "native"
        ? []
        : [
            {
              status: "success",
              usage: { input_tokens: 5, output_tokens: 1 },
              providerMetadata: { gateway: { marketCost: "0.001" } },
            },
          ],
    errors: [],
    telemetryParseErrors: [],
    sourceChanges: [],
    changes: [],
    ...overrides,
  });
  await writeFile(
    report,
    JSON.stringify({
      status: "completed",
      plan,
      trials: [trial("native", "native"), trial("prepared", "prepared"), trial("jev", "jev")],
    }),
  );
  await execute(
    process.platform === "win32" ? "python" : "python3",
    ["scripts/summarize-optimization.py", "--report", report, "--output", output],
    { cwd: process.cwd() },
  );
  const summary = JSON.parse(await readFile(join(output, "summary.json"), "utf8"));
  assert.equal(summary.plannedTrials, 3);
  assert.equal(summary.reportedTrials, 3);
  assert.equal(summary.pairedComparisons.length, 1);
  assert.equal(summary.pairedComparisons[0].preparedQualityComparison, "tie");
  assert.equal(summary.pairedComparisons[0].jevQualityComparison, "tie");
  assert.equal(summary.qualityCounts.prepared.tie, 1);
  assert.equal(summary.qualityCounts.jev.tie, 1);
  assert.equal(summary.pairedComparisons[0].jevVsPreparedQualityComparison, "tie");
  assert.equal(summary.qualityCounts.jevVsPrepared.tie, 1);
});

test("optimization summary marks provider failures and local preparation without inventing usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-optimization-telemetry-"));
  const report = join(root, "report.json");
  const output = join(root, "summary");
  const plan = ["native", "prepared", "jev"].map((arm) => ({
    name: arm,
    level: "low",
    variant: "reference",
    arm,
    repeat: 1,
  }));
  const common = {
    level: "low",
    variant: "reference",
    repeat: 1,
    acceptance: { passed: true },
    agentExitCode: 0,
    timedOut: false,
    protocolCompliant: true,
    telemetryValid: true,
    contractUnchanged: true,
    usageAvailable: true,
    providerUsageComplete: true,
    mainUsage: [{ input_tokens: 10, cached_input_tokens: 2, output_tokens: 3 }],
    errors: [],
    telemetryParseErrors: [],
  };
  await writeFile(
    report,
    JSON.stringify({
      status: "completed",
      plan,
      trials: [
        { ...common, name: "native", arm: "native", providerCalls: [] },
        { ...common, name: "prepared", arm: "prepared", providerCalls: [] },
        {
          ...common,
          name: "jev",
          arm: "jev",
          providerUsageComplete: false,
          providerCalls: [{ status: "provider_error" }],
        },
      ],
    }),
  );
  await execute(
    process.platform === "win32" ? "python" : "python3",
    ["scripts/summarize-optimization.py", "--report", report, "--output", output],
    { cwd: process.cwd() },
  );
  const summary = JSON.parse(await readFile(join(output, "summary.json"), "utf8"));
  const rows = Object.fromEntries(summary.trials.map((row: { name: string }) => [row.name, row]));
  assert.equal(rows.native.providerUsageStatus, "not_applicable");
  assert.equal(rows.prepared.providerUsageStatus, "not_needed");
  assert.equal(rows.jev.providerUsageStatus, "failed");
  assert.equal(rows.jev.providerInputTokens, null);
  assert.equal(rows.jev.providerOutputTokens, null);
  assert.equal(rows.jev.providerMarketCost, null);
  assert.equal(rows.jev.status, "failed_or_partial");
  assert.equal(rows.jev.primaryAcceptancePass, true);
  assert.equal(summary.pairedComparisons[0].jevEligible, false);
  assert.equal(summary.pairedComparisons[0].jevVsPreparedEligible, false);
  assert.equal(summary.pairedComparisons[0].preparedEligible, true);
});

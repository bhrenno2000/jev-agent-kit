import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);

test("complexity summary preserves multi-turn totals, unknown usage, and attribution limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-summary-"));
  const report = join(root, "report.json");
  const output = join(root, "summary");
  const base = (
    name: string,
    arm: string,
    repeat: number,
    overrides: Record<string, unknown> = {},
  ) => ({
    name,
    level: "low",
    arm,
    repeat,
    elapsedSeconds: 1,
    agentExitCode: 0,
    timedOut: false,
    acceptance: { passed: true },
    mainUsage: [
      { input_tokens: 60, cached_input_tokens: 20, output_tokens: 5 },
      { input_tokens: 40, cached_input_tokens: 10, output_tokens: 5 },
    ],
    usageAvailable: true,
    telemetryValid: true,
    providerUsageComplete: true,
    protocolCompliant: true,
    jevCalls: [],
    mcpCalls: [],
    telemetryParseErrors: [],
    ...overrides,
  });
  await writeFile(
    report,
    JSON.stringify({
      status: "completed",
      model: "test-model",
      effort: "high",
      workers: 2,
      plan: [{}, {}, {}, {}],
      trials: [
        base("low-baseline-1", "baseline", 1),
        base("low-optional-1", "optional", 1, {
          acceptance: { passed: false },
          providerUsageComplete: false,
        }),
        base("low-baseline-2", "baseline", 2, {
          mainUsage: [{ input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 }],
        }),
        base("low-optional-2", "optional", 2, {
          mainUsage: [{ input_tokens: 80, cached_input_tokens: 30, output_tokens: 40 }],
          jevCalls: [{ status: "success" }],
        }),
        base("low-guided-1", "guided", 1, { protocolCompliant: false, jevCalls: [] }),
        base("low-invalid-1", "optional", 3, {
          mainUsage: [{ input_tokens: 100, cached_input_tokens: 101, output_tokens: 1 }, "invalid"],
          jevCalls: [{ status: "success", providerMetadata: { gateway: {} }, meta: {} }],
        }),
        base("low-mixed-1", "optional", 4, {
          jevCalls: [
            {
              status: "success",
              usage: { input_tokens: 1, output_tokens: 0 },
              providerMetadata: { gateway: { cost: "1.2" } },
              meta: { attempts: 1 },
            },
            { status: "error", code: "timeout" },
          ],
        }),
        base("low-error-1", "optional", 5, {
          jevCalls: [{ status: "error", code: "network_error" }],
        }),
        base("low-malformed-1", "optional", 6, {
          jevCalls: [
            {
              status: "success",
              usage: { input_tokens: 1, output_tokens: 1 },
              providerMetadata: "bad",
              meta: "bad",
            },
            "malformed",
          ],
        }),
      ],
    }),
  );
  await execute(
    process.platform === "win32" ? "python" : "python3",
    ["scripts/summarize-complexity.py", "--report", report, "--output", output],
    { cwd: process.cwd() },
  );
  const summary = JSON.parse(await readFile(join(output, "summary.json"), "utf8"));
  const rows = Object.fromEntries(summary.trials.map((row: { name: string }) => [row.name, row]));
  assert.equal(rows["low-baseline-1"].mainInputTokens, 100);
  assert.equal(rows["low-baseline-1"].mainCachedInputTokens, 30);
  assert.equal(rows["low-baseline-1"].mainUncachedInputTokens, 70);
  assert.equal(rows["low-baseline-1"].mainNominalTokenSum, 110);
  assert.equal(rows["low-optional-2"].providerUsageStatus, "incomplete");
  assert.equal(rows["low-optional-2"].httpAttemptCount, null);
  assert.equal(rows["low-guided-1"].guidedProtocolFailure, true);
  assert.equal(rows["low-invalid-1"].mainNominalTokenSum, null);
  assert.equal(rows["low-invalid-1"].gatewayBillingStatus, "incomplete");
  assert.equal(rows["low-mixed-1"].providerUsageStatus, "incomplete");
  assert.equal(rows["low-mixed-1"].providerInputTokens, null);
  assert.equal(rows["low-mixed-1"].reportedGatewayCost, null);
  assert.equal(rows["low-mixed-1"].httpAttemptCount, null);
  assert.equal(rows["low-error-1"].providerUsageStatus, "incomplete");
  assert.equal(rows["low-error-1"].reportedGatewayCost, null);
  assert.equal(rows["low-error-1"].httpAttemptCount, null);
  assert.equal(rows["low-malformed-1"].providerUsageStatus, "incomplete");
  assert.equal(rows["low-malformed-1"].gatewayBillingStatus, "incomplete");
  assert.equal(rows["low-malformed-1"].httpAttemptCount, null);
  const failedPair = summary.pairedComparisons.find(
    (item: { repeat: number }) => item.repeat === 1,
  );
  assert.equal(failedPair.qualityRegression, true);
  const noCallPair = summary.pairedComparisons.find(
    (item: { repeat: number }) => item.repeat === 2,
  );
  assert.ok(noCallPair, JSON.stringify(summary.pairedComparisons));
  assert.equal(noCallPair.attributionEligible, false, JSON.stringify(noCallPair));
  assert.equal(noCallPair.inputDeltaPercent, -20);
  assert.equal(noCallPair.mainNominalTokenDeltaPercent, ((120 - 110) / 110) * 100);
  assert.equal(noCallPair.netCostBenefitVerified, "unknown");
});

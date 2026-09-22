import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EvidencePreparer } from "../../src/prepare.js";
import { JevClient } from "../../src/core/index.js";

const source =
  "export function alpha() { return 1; }\nexport function beta() { return 2; }\nexport function gamma() { return 3; }\n";
const input = {
  query: "Review behavioral requirements",
  paths: ["entry.mjs"],
  contractPath: "contracts.json",
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "jev-preparation-"));
  await writeFile(join(root, "entry.mjs"), source);
  await writeFile(
    join(root, "contracts.json"),
    JSON.stringify({ claims: [{ id: "result", requirement: "Results remain stable" }] }),
  );
  return root;
}

function provider(mode: "focus" | "unknown" | "fail" = "focus") {
  let calls = 0;
  const client = new JevClient({
    apiKey: "standin-only",
    endpoint: "http://127.0.0.1:4321/v1/systemone",
    fetch: async (_, init) => {
      calls++;
      if (mode === "fail") return new Response("private server message", { status: 400 });
      const request = JSON.parse(String(init?.body));
      const labels = Object.keys(request.questions.focus.criteria);
      const choice = mode === "unknown" ? "unknown" : "candidate_0";
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            focus: {
              type: "choice",
              choice,
              probabilities: Object.fromEntries(
                labels.map((key) => [key, key === choice ? 0.97 : 0.03 / (labels.length - 1)]),
              ),
              confidence: 0.95,
            },
          },
          usage: { input_tokens: 100, output_tokens: 4 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  return { client, calls: () => calls };
}

test("local preparation preserves complete evidence without provider calls", async () => {
  const root = await fixture();
  const standin = provider();
  try {
    const result = await new EvidencePreparer(standin.client).prepare(root, input);
    assert.equal(standin.calls(), 0);
    assert.equal(result.mode, "local");
    assert.match(JSON.stringify(result.evidence), /return 1/);
    assert.deepEqual(result.checklist, [
      { id: "result", requirement: "Results remain stable", status: "unverified" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Jev focus keeps the identical deterministic evidence and reports actual usage", async () => {
  const root = await fixture();
  const standin = provider();
  try {
    const preparer = new EvidencePreparer(standin.client);
    const local = await preparer.prepare(root, input);
    const semantic = await preparer.prepare(root, { ...input, mode: "jev" });
    assert.deepEqual(local.evidence, semantic.evidence);
    assert.equal((semantic.decision as { status: string }).status, "focused");
    assert.equal(standin.calls(), 1);
    assert.deepEqual((semantic.evaluation as { usage: unknown }).usage, {
      input_tokens: 100,
      output_tokens: 4,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cache skips repeated inference but omits source only after an explicit matching receipt", async () => {
  const root = await fixture();
  const standin = provider();
  try {
    const preparer = new EvidencePreparer(standin.client);
    const first = await preparer.prepare(root, { ...input, mode: "jev" });
    const repeated = await preparer.prepare(root, { ...input, mode: "jev" });
    assert.deepEqual(repeated.evidence, first.evidence);
    assert.equal(repeated.unchanged, false);
    (repeated.decision as { reason: string }).reason = "caller mutation";
    const acknowledged = await preparer.prepare(root, {
      ...input,
      mode: "jev",
      receipt: first.receipt,
    });
    assert.equal(acknowledged.unchanged, true);
    assert.equal(acknowledged.evidence, undefined);
    assert.notEqual((acknowledged.decision as { reason: string }).reason, "caller mutation");
    assert.equal(standin.calls(), 1);
    assert.equal((acknowledged.evaluation as { calls: number }).calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source, contracts, query, root and expiry invalidate previous receipts", async () => {
  const root = await fixture();
  const secondRoot = await fixture();
  const standin = provider();
  let now = 1000;
  try {
    const preparer = new EvidencePreparer(standin.client, () => now);
    const first = await preparer.prepare(root, { ...input, mode: "jev" });
    await writeFile(join(root, "entry.mjs"), source.replace("return 1", "return 4"));
    const changed = await preparer.prepare(root, { ...input, mode: "jev", receipt: first.receipt });
    assert.equal(changed.unchanged, false);
    assert.notEqual(changed.receipt, first.receipt);
    await writeFile(
      join(root, "contracts.json"),
      JSON.stringify({ claims: [{ id: "result", requirement: "Results are immutable" }] }),
    );
    const contractChanged = await preparer.prepare(root, {
      ...input,
      mode: "jev",
      receipt: changed.receipt,
    });
    assert.notEqual(contractChanged.receipt, changed.receipt);
    const queryChanged = await preparer.prepare(root, {
      ...input,
      query: "Review robustness",
      mode: "jev",
      receipt: contractChanged.receipt,
    });
    assert.notEqual(queryChanged.receipt, contractChanged.receipt);
    const otherRoot = await preparer.prepare(secondRoot, {
      ...input,
      mode: "jev",
      receipt: first.receipt,
    });
    assert.equal(otherRoot.unchanged, false);
    now += 300001;
    const expired = await preparer.prepare(secondRoot, {
      ...input,
      mode: "jev",
      receipt: otherRoot.receipt,
    });
    assert.equal(expired.unchanged, false);
    assert.equal(expired.cache, "miss");
    assert.equal(standin.calls(), 6);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(secondRoot, { recursive: true, force: true });
  }
});

test("provider failure and abstention retain evidence and never imply acceptance", async () => {
  const root = await fixture();
  try {
    for (const mode of ["fail", "unknown"] as const) {
      const standin = provider(mode);
      const preparer = new EvidencePreparer(standin.client);
      const result = await preparer.prepare(root, { ...input, mode: "jev" });
      assert.ok(result.evidence);
      assert.equal(
        (result.decision as { status: string }).status,
        mode === "fail" ? "unavailable" : "inconclusive",
      );
      assert.doesNotMatch(JSON.stringify(result), /private server message|standin-only/);
      if (mode === "fail") {
        assert.equal((result.evaluation as { usage: unknown }).usage, null);
        const again = await preparer.prepare(root, {
          ...input,
          mode: "jev",
          receipt: result.receipt,
        });
        assert.equal(again.unchanged, false);
        assert.equal(standin.calls(), 2);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exact symbol routing skips Jev and rejected contracts never invoke it", async () => {
  const root = await fixture();
  const standin = provider();
  try {
    const preparer = new EvidencePreparer(standin.client);
    const exact = await preparer.prepare(root, { ...input, query: "Alpha", mode: "jev" });
    assert.equal((exact.decision as { status: string }).status, "skipped");
    await assert.rejects(
      preparer.prepare(root, { ...input, contractPath: "../contracts.json", mode: "jev" }),
    );
    await writeFile(
      join(root, "bad.json"),
      JSON.stringify({
        claims: [
          { id: "x", requirement: "x" },
          { id: "x", requirement: "y" },
        ],
      }),
    );
    await assert.rejects(preparer.prepare(root, { ...input, contractPath: "bad.json" }));
    await symlink(join(root, "contracts.json"), join(root, "linked.json"));
    await assert.rejects(preparer.prepare(root, { ...input, contractPath: "linked.json" }));
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(preparer.prepare(root, input, cancelled.signal));
    assert.equal(standin.calls(), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

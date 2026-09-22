# Structured preparation and selective Jev

Version 0.3.0 adds `jev_prepare`. It returns exact JavaScript or TypeScript declaration blocks, local module dependencies, provenance, coverage gaps, and an explicit acceptance checklist. The default `local` mode does not call an inference provider. The existing tools retain their behavior.

## Workflow

Write precise public requirements before editing. Record boundary conditions, result shapes, compatibility, failure behavior, and concurrency rules in a `contracts.json` file:

```json
{
  "claims": [
    {
      "id": "failure-atomicity",
      "requirement": "A rejected operation leaves inventory and idempotency state unchanged."
    }
  ]
}
```

Use the known module entry point to prepare evidence:

```json
{
  "query": "Inspect transaction failure behavior",
  "paths": ["src/index.mjs"],
  "contractPath": "contracts.json",
  "mode": "local"
}
```

The CLI accepts the same object:

```sh
jev-agent prepare --root /absolute/project --input request.json
```

The checklist starts with every claim `unverified`. Neither parsing a contract nor receiving a Jev score proves any claim. The main agent must inspect relevant implementation, write or run appropriate tests, preserve compatible behavior, and resolve missing dependencies. Independent acceptance checks should verify observable behavior and interactions, rather than copy the implementation.

## Structural evidence

The reader uses the TypeScript parser to select whole top-level statements and follow supported local imports and re-exports. Exact symbol matches and lexical task relevance order the evidence. This is a bounded module graph, not a complete language-server call graph or proof that all relevant code was found. Native search and reads remain available for callers outside the graph, external packages, unsupported languages, dynamic dependencies, and omitted source.

Limits include 16 entry paths, 64 source files, 128 KiB per file, 1 MiB of loaded source, and a default 16,000-byte source budget. A declaration is retained whole or omitted with coverage metadata. File paths, line ranges, hashes, and explicit omissions allow the agent to recover original evidence. Source text is data, not instructions.

## Selective semantic focus

`mode: "jev"` uses the same deterministic evidence packet. It may make one bounded Choice request to identify a useful starting point among at most six supplied candidates, with an explicit `unknown` option. An exact query-symbol match, fewer than three candidates, or excessive state size skips the remote call. Jev never removes evidence or invents a rationale, counterexample, fix, or test.

The provisional policy requires both the selected option probability and provider confidence to reach 0.8 before returning a focus. These are different quantities and the thresholds are not calibrated correctness guarantees. Inconclusive answers and provider errors preserve the deterministic packet. Complexity alone never forces a call.

This feature has measurable overhead. Its benefit must be assessed against both native work and the same local preparation without Jev. A smaller response or fewer provider calls alone does not establish fewer whole-agent tokens or better code.

## Versioned reuse

Each server process keeps at most 32 cached decisions for five minutes. The key includes the pinned root, full scanned-source snapshot and coverage state, query, requirements, mode, budget, provider/model identifier, and policy version. Source is reread to validate the snapshot on every call. The cache does not survive process restart and is not a persistent memory system.

A repeated request still returns source unless the caller explicitly supplies the matching `receipt` from a prior response. Only then can `unchanged: true` omit source already acknowledged by that caller. Changing a dependency or requirement invalidates the receipt. A fresh agent should omit a receipt unless it actually has the corresponding evidence; a hash alone is not context. Model aliases can change remotely, so cache expiry bounds reuse but does not pin a provider's hidden implementation version.

For delegation, share the original requirement, exact artifact references, source versions, actual test results, and unresolved issues. Do not replace required context with an unsupported summary or a verifier score. This adapter does not certify user-supplied test results, execute arbitrary commands, or control the host agent's conversation memory.

## Evaluation

The optimization experiment compares native review, local preparation, and identical preparation with selective Jev. All arms receive the same requirements and source snapshots. Defective seeds measure repairs; correct references measure unnecessary changes and regressions. Repeated trials, failures, missing telemetry, independent acceptance outcomes, cached input, provider usage, and rework remain visible.

No general quality or savings claim follows from installation. Results and release decisions belong in the separate study report after execution and independent review.

# Advisory verification experiment

This study isolates Jev as a claim verifier, rather than a source selector. All tasks are authored fixtures. The experiment is not a production quality guarantee or a public benchmark score.

The [completed report](../../docs/verification-study.md) distinguishes the original 24 runs from four supplementary controls. The original study used commit `70a3e32fc4093f5112754191dac0184c9f0180a1`. Current fixtures clarify the low input domain and neutralize medium package names after discovering limitations in the original controls; those corrections do not rewrite its scores.

## Frozen design

Three tasks cover interval planning, asynchronous scoped caching, and concurrent partitioned event ingestion. Each has a defective implementation and a correct reference used as a clean control. Two of four atomic claims are false in each defective implementation; all four are true in each reference. External behavioral tests cover more cases than the four claims. Public tests pass in both versions. Ground-truth labels and external checks stay outside agent workspaces.

Run 24 complete review trajectories: three levels, two input variants, native versus Jev-assisted review, and two repetitions. Reverse variant and arm submission order in the second repetition. Use the same `gpt-6-astra` model, `xhigh` effort, source snapshot, neutral four-claim checklist, public tests, and per-level limit across arms. Two workers share the local host. Limits are 300, 480, and 720 seconds. Trial directories use opaque identifiers to avoid disclosing whether the input is defective or correct.

The native reviewer uses normal tools, reasoning, and tests. The assisted reviewer additionally calls `jev_verify_claims` once before changing source. Both must preserve compliant code, fix only demonstrated contract violations, and run regression tests. Jev judgments remain advisory and can be rejected by the main agent.

The experimental MCP reads bounded local source itself, constructs the four questions, and returns judgments plus source hashes. The main agent does not need to transcribe source into tool arguments. This is a research wrapper, not a new production tool or an automatic approval gate. It is limited to authored fixture workspaces and is not exported in the installed package.

## Measurements and decision rules

- Primary quality: complete agent delivery passing all external behavioral checks. Also report timeout, invalid telemetry, modified contracts, and failure to verify the original source.
- Defective inputs: compare successful repairs between paired arms. Clean inputs: compare regressions and source edits without an established defect. Added tests are reported separately from source modifications.
- Record every original trajectory, source patch, provider response, usage, retry count, latency, and check outcome. Never replace a failure with its subsequent repair.
- Compare actual main input, cached input subset, output, and input-plus-output totals. Keep Jev usage and reported gateway billing separate. Unknown cost stays unknown. Nominal token counts across different tokenizers are not dollar costs.
- A secondary direct capability test asks each positive claim and its logical inverse twice on the six frozen inputs: 12 calls and 96 judgments, balanced by expected truth value. With the predeclared thresholds, probability at least 0.8 means supported, at most 0.2 means contradicted, and intermediate values abstain. Record contradictory paired answers and false approval of a defective property.
- Any observed false approval rejects using Jev as an autonomous approval gate. General quality improvement is not established by a confident score, a lower input count, or a successful reference fixture.
- Paired quality and token differences are exploratory with two repetitions. Report the sample and all outcomes; do not claim statistical significance, universal savings, or improved intelligence. If native review already succeeds, these cases cannot establish additional quality benefit.

The experiment must finish with unchanged product source/build, wrapper, runner, and frozen fixture hashes. Summaries must distinguish original outcomes from supervised rework and direct capability from whole-agent effects.

## Reproduce

Node.js 20.19+, Python 3.9+, and an authenticated Codex CLI are required. Live runs consume model usage. Keep the Vercel key in a protected external file.

```sh
python3 scripts/verification-benchmark.py --output /absolute/new/preflight --model gpt-6-astra --effort xhigh
python3 scripts/verification-benchmark.py --output /absolute/new/study --model gpt-6-astra --effort xhigh --key-file /absolute/private/vercel-key --run
JEV_PROVIDER=vercel AI_GATEWAY_API_KEY_FILE=/absolute/private/vercel-key node scripts/verification-capability.mjs /absolute/study/frozen /absolute/new/capability-results
```

The separately declared clean controls use current fixtures and one repetition:

```sh
python3 scripts/verification-benchmark.py --output /absolute/new/clean-controls --model gpt-6-astra --effort xhigh --tasks low medium --variants reference --repetitions 1 --key-file /absolute/private/vercel-key --run
```

Do not change the source or measurement scripts during a live study. The production MCP remains optional regardless of this experiment's outcome.

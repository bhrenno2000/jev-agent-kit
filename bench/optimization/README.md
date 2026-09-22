# Three-arm coding workflow experiment

The experiment compares native coding, deterministic structural preparation, and the same preparation with optional Jev focus. All three arms receive identical task and contract information. Contracts are shared by every arm, so this study cannot isolate the benefit of writing better requirements.

Each of three authored JavaScript tasks has a defective seed and a tested reference. The low task filters and paginates records, the medium task manages concurrent asynchronous cache generations, and the high task implements serialized tenant checkout with canonical idempotency and failure rollback. Complexity describes interacting behavior, not production repository size. The active module graphs are small; unrelated utility files do not make them representative large repositories.

The primary plan has 36 trajectories: three levels, two variants, three arms, and two repetitions. Submission order rotates by level, variant, and repetition. Two workers share a host; wall times are not isolated latency estimates. Model and effort are fixed at the user's existing `gpt-6-astra` and `xhigh`. Limits are 360, 600, and 900 seconds for low, medium, and high respectively.

Both optimized arms must initially call `jev_prepare` with the same request. The wrapper pins local or Jev mode. It uses production code, records actual provider calls, and never supplies private acceptance tests or expected truth labels to the agent. Jev can skip inference or abstain; those are retained outcomes. Normal source reads and tests remain available. This is a controlled workflow comparison, not a claim that installing an optional tool guarantees its use.

## Historical frozen acceptance

Before model execution, all public suites pass on both variants. Independent external acceptance produces:

| Level  | Seed  | Reference |
| ------ | ----- | --------- |
| Low    | 4/7   | 7/7       |
| Medium | 5/9   | 9/9       |
| High   | 18/23 | 23/23     |

The high suite includes eight additional black-box cases reviewed by the orchestrator. All input domains, error conditions, zero-limit behavior, clock semantics, deep-copy ownership, and idempotency identity are public requirements. Expected implementation labels and external checks stay outside agent workspaces. The reference is a tested control, not proof of exhaustive correctness.

The completed study is preserved at commit `e05dea822c67f8860c85513d25e2f9f26cd251f6` and in `docs/results/2026-09-22/optimization/frozen`. A post hoc sparse-array check exposed a reference defect. The current high reference and suite are corrected: seed 18/24, reference 24/24. Historical high scores remain 23-test outcomes. See [the full report](../../docs/optimization-study.md).

## Outcomes and interpretation

Primary quality is all external checks passing, alongside a completed agent process. Protocol, telemetry, source changes, and acceptance remain separate fields. Correct-reference source changes require review and are not automatically improvements or regressions. No failed, missing, timed-out, or inconclusive run is replaced with a favorable rerun.

Count main input and output across every completed model turn, with cached input retained as a subset. Report provider usage, calls, attempts, and observed gateway billing separately. Do not equate tokenizers or infer main-agent dollars from nominal token sums. Preparation, benchmark authorship, orchestration, and independent reviewer costs are outside trajectory totals and must be disclosed.

If a delivery fails behavioral acceptance, at most one separate native repair may receive grader feedback using the same model and effort. That repair does not replace the failed primary outcome. Its usage and residual failures must remain separately visible; combined delivery cost must include both attempts. Repair is unnecessary for a correct delivery with only an infrastructure or telemetry issue.

Compare native versus local preparation, native versus Jev preparation, and Jev versus local preparation. Gains shared by the two prepared arms cannot be attributed to Jev. Two repetitions on three synthetic tasks cannot establish a general or statistically robust improvement. The product decision must retain quality losses, uncertainty, and per-level variation instead of advertising a favorable aggregate.

## Execution

The runner freezes fixture copies, source/build hashes, measurement-wrapper hashes, and the committed protocol before starting. Live execution requires a clean checkout and an external Vercel credential file. No credential value belongs in a prompt, source file, or artifact.

```sh
npm run check
python3 scripts/optimization-benchmark.py --prepare-only --output /absolute/new-preflight
python3 scripts/optimization-benchmark.py --run --output /absolute/new-study --key-file /absolute/private/key-file --repetitions 2 --workers 2
python3 scripts/summarize-optimization.py --report /absolute/new-study/report.json --output /absolute/new-summary
```

Raw JSONL traces remain local. Published evidence should include all outcomes, exact patches, source hashes, grader output, provider telemetry, and integrity records. Final patches must reproduce from the frozen inputs before any results are approved.

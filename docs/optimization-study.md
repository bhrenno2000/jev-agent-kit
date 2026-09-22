# Structural preparation and selective Jev study

Completed on September 22, 2026 with version 0.3.0. Mandatory preparation is **not approved** as a quality or token-saving default. Native work used fewer main-agent tokens and passed more of the checks applied after review. The adapter remains an optional capability; this study does not show that Jev improves delivery quality.

## Design and preserved evidence

The frozen protocol used commit `e05dea822c67f8860c85513d25e2f9f26cd251f6`, Codex CLI 0.155.1, `gpt-6-astra`, reasoning effort `xhigh`, Node.js 22.18.0, and two workers on one macOS host. The 36 trajectories cover three authored tasks, defective and intended-correct inputs, three workflows, and two repetitions. Submission order rotates. All arms received the same public task and requirements:

- **Native:** ordinary source inspection, implementation, and tests.
- **Prepared:** one initial production `jev_prepare` call in local mode, then independent work.
- **Jev:** the identical preparation with optional remote advisory focus, then independent work.

The tasks exercise stable filtering/pagination and copy ownership; asynchronous cache expiry, coalescing, rejection, and invalidation generations; and concurrent tenant checkout, canonical idempotency, request capture, rollback, and copies. Their active module graphs are small. Behavioral complexity is not evidence of representative production repository scale.

All 36 planned outcomes completed without replacement, timeout, parse errors, or agent errors. Source, build, frozen fixtures, runner, and measurement-wrapper integrity passed. All 24 optimized runs called preparation before executing a command; their source provenance matched the initial workspace and their contracts remained unchanged. Each call was a first-use preparation; this study did not exercise receipt reuse across agent calls.

[Protocol](results/2026-09-22/optimization/protocol.json), [original outcomes](results/2026-09-22/optimization/report.json), [frozen inputs](results/2026-09-22/optimization/frozen/README.md), [original-score summary](results/2026-09-22/optimization/summary.json), and [command record](results/2026-09-22/optimization/command-review.json) are preserved. Raw model traces remain local; their hashes are recorded. Every exported patch reproduced the exact final workspace hashes and original acceptance counts: [patch replay](results/2026-09-22/optimization/patch-replay.json).

## Quality and independent review

The original external acceptance suite produced 36/36 passes, comprising 468 test executions. Separately rerunning every delivered public and agent-authored test suite produced 394 passing tests across the 36 workspaces. An AST audit found no code comments or symlinks in 635 source/test modules. These checks do not establish exhaustive correctness.

Review of native high-reference trial 16 exposed a real omission in the supposedly correct fixture. Its JSON validator compared an array's own enumerable key count with its length. `Array(1)` with an extra named property satisfies that comparison even though its indexed element is missing. The frozen reference incorrectly accepted that invalid payload.

The orchestrator reproduced the defect, wrote a separate rejection-and-state-preservation test, and applied it equally to all twelve original high outputs. Both native reference reviews fixed the case; neither prepared reference review and neither Jev reference review fixed it. The six repaired high seeds passed it. This case was selected after observing a native solution, so it is a disclosed post hoc audit, not a preregistered independent quality estimate or a causal proof about Jev.

| Workflow | Original acceptance | All checks applied after review | High task after review |
| --- | ---: | ---: | ---: |
| Native | 12/12 | 12/12 | 4/4 |
| Prepared | 12/12 | 10/12 | 2/4 |
| Jev | 12/12 | 10/12 | 2/4 |

The low and medium tasks passed all applied checks in every arm. Failures remain attached to `trial-17`, `trial-18`, `trial-34`, and `trial-35`; their primary scores are not rewritten. The high reference is not a clean control for this discovered case. [Post hoc definition](results/2026-09-22/optimization/posthoc/acceptance.test.mjs), [per-trial results](results/2026-09-22/optimization/posthoc/report.json), and [frozen-reference failure](results/2026-09-22/optimization/posthoc/frozen-reference.tap).

Reference source changes were also reviewed. Medium trials 11, 12, 28, 29, and 30 add an invalid-key guard to `invalidate`; rejection for that invalid argument is unspecified, so these are defensive changes rather than demonstrated quality wins or regressions. High trials 16, 18, and 36 add defensive container/request guards; only 16 and 36 additionally correct the demonstrated sparse-array gap. A native `TypeError` for null constructor input already satisfies rejection where no error type is prescribed. Merely changing source is not a quality gain, and preserving the flawed reference is not automatically success.

## Main-agent tokens

The nominal sum below is input plus output. Input includes cached input; the cache column is a subset, not an additional charge. These are usage observations, not equivalent dollars.

| Workflow | Input | Cached input subset | Output | Nominal total | Difference from native |
| --- | ---: | ---: | ---: | ---: | ---: |
| Native | 1,842,158 | 1,557,504 | 49,387 | 1,891,545 | — |
| Prepared | 2,352,559 | 2,050,304 | 50,041 | 2,402,600 | +27.02% |
| Jev | 2,433,842 | 2,100,864 | 51,415 | 2,485,257 | +31.39% |

| Task | Native nominal tokens | Prepared versus native | Jev versus native | Jev versus prepared |
| --- | ---: | ---: | ---: | ---: |
| Low | 494,040 | +43.88% | +20.84% | -16.02% |
| Medium | 556,762 | +52.80% | +51.01% | -1.17% |
| High | 840,743 | +0.03% | +24.59% | +24.55% |
| All | 1,891,545 | +27.02% | +31.39% | +3.44% |

Considering only uncached input plus output, native used 334,041 tokens, prepared 352,296 (+5.46%), and Jev 384,393 (+15.07%). This alternative also is not a dollar calculation: input, cached input, and output can have different rates. Jev used 9.11% more uncached-input-plus-output than prepared. Differences reflect the complete observed workflows and model variation; the design does not identify a single causal source of overhead.

The low Jev-mode trajectories made **zero remote calls**. Their difference from prepared therefore cannot be credited to Jev inference. Two repetitions are insufficient to establish a stable distribution or statistical significance.

## Provider behavior

Across the twelve Jev-mode trajectories, four low cases skipped inference because there were too few candidates. Eight remote requests completed successfully, each in one attempt. Seven were inconclusive under the fixed probability/confidence policy, and one medium reference case returned an advisory focus. Thresholds were not lowered after seeing the results. Inconclusive answers preserved the complete deterministic evidence packet.

Provider usage was 17,098 input and 640 output tokens, additional to the main-agent totals. The gateway recorded charged cost `0` and market cost `0.000718116` for these eight calls. These observations neither guarantee future pricing nor include the main model. No provider failures or unknown usage were converted into zeros.

Median trajectory wall times were 136.34 seconds native, 153.02 prepared, and 148.11 Jev. Shared-host concurrency and small samples prevent treating these as isolated latency estimates.

## Separate repairs

All four failed reviewed deliveries received one separate native repair, using the same model and effort with concrete grader feedback. All four repairs passed the original suite, the additional payload case, and every delivered public/agent-authored test. Exact repair patches reproduced the final hashes and those checks. No repair timed out or had missing usage; all 40 repaired source/test modules remained free of comments and symlinks. Original workspaces and scores are preserved.

| Original workflow | Separate repairs | Extra input | Extra cached input subset | Extra output | Original plus repair nominal tokens | Difference from native |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Native | 0 | 0 | 0 | 0 | 1,891,545 | — |
| Prepared | 2 | 315,924 | 259,328 | 4,763 | 2,723,287 | +43.97% |
| Jev | 2 | 335,820 | 279,936 | 4,210 | 2,825,287 | +49.36% |

These are main-agent totals. Jev's 17,738 provider tokens remain additional and use a separate accounting basis. Grader-assisted repairs are not equivalent to unassisted first-pass success and do not erase the four rejected deliveries. [Repair outcomes](results/2026-09-22/optimization/repairs/report.json), [repair replay](results/2026-09-22/optimization/repairs/replay.json), and [aggregate arithmetic](results/2026-09-22/optimization/aggregate.json).

## Current fixture and release decision

After the frozen run completed, the current high reference gained the missing array-index validation and its external suite gained that regression. Current preflight is low seed 4/7 versus reference 7/7, medium 5/9 versus 9/9, and high 18/24 versus 24/24. This correction does not change the archived 23-test high suite or any historical result.

Version 0.3.0 provides local structural evidence, explicit unverified requirements, coverage and recovery information, optional Jev focus, and versioned receipts. Implementation tests passed 83/83 on Node.js 20.19.4 and 22.23.2. Global and project installation were checked in isolated prefixes. These validate the implemented behavior, not improved agent performance.

Keep native work as the default for these task families. Use exact search for known symbols and small files. Consider structural preparation when navigating a larger unfamiliar dependency graph, and reuse receipts only while the original evidence is actually available. Those remain candidates for a future representative evaluation; this study did not establish their net benefit. Do not turn an advisory focus into a proof, remove evidence after abstention, or force semantic calls merely because a task is complex.

The sample is three synthetic tasks, not the user's production repositories. Contracts are identical in every arm, so any benefit of better requirements is not isolated here. Study design, fixture authorship, orchestration, independent review, packaging, and this conversation's tokens are excluded from trajectory usage. Separate repairs are counted explicitly. Prior studies use different corpora and must not be pooled with this one to advertise savings.

## Reproduce delivered artifacts

The archive includes the exact frozen inputs. With Node.js, Python 3.9+, and Git:

```sh
python3 docs/results/2026-09-22/optimization/replay.py --artifacts docs/results/2026-09-22/optimization --output /absolute/new-replay
```

The replay verifies final file hashes and reruns original external acceptance for all 36 exported patches. For a reconstructed high workspace, run the separately disclosed post hoc case:

```sh
BENCH_WORKSPACE=/absolute/new-replay/trial-17 node --test docs/results/2026-09-22/optimization/posthoc/acceptance.test.mjs
```

That original failed delivery should still fail the additional case. Applying its separately archived repair is a distinct result. Fresh model execution follows the [benchmark instructions](../bench/optimization/README.md) and incurs new usage; it is not a replay of the observed model behavior.

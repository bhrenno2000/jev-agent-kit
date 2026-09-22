# Coding workflow validation: low, medium, and high complexity

## Decision

The MCP adapter works, but this study does **not** approve mandatory Jev use, automatic source compression, or a token-savings claim. Optional agents skipped Jev in all six treatment runs. The three explicit-use diagnostics invoked it successfully, then read the source with native tools. Their nominal main-agent token totals exceeded the mean of the corresponding two native runs. One diagnostic also broke the existing failure-result shape.

Keep Jev optional for bounded semantic decisions supported by explicit evidence. Preserve ordinary search, source reads, reasoning, and tests. Installing an MCP does not establish that using it improves a coding task.

## Tasks and protocol

These are authored, dependency-free coding tasks, not production repositories or a public benchmark. The main model was `gpt-6-astra` at `xhigh`, preserving the user's configured model and effort. All arms used the same CLI version, task seed, public tests, and per-level time limit. External acceptance tests and reference implementations were outside each agent workspace.

| Level  | Task                          | Interacting requirements                                                                                    | Primary checks |
| ------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------: |
| Low    | Cursor pagination             | Initial cursor, continuation, order, page limit, immutable responses                                        |              3 |
| Medium | Event delivery                | Retry budget, capped exponential backoff, success deduplication, failure persistence, immutable snapshots   |              8 |
| High   | Tenant inventory and checkout | Last-unit concurrency, tenant scope, payload-sensitive idempotency, rollback, atomic outbox, stable retries |             14 |

Each level had two native baseline runs, two runs with optional MCP availability, and one explicit-use diagnostic. The second pair reversed submission order. Two workers shared the host. Time limits were 240, 480, and 900 seconds. Every original run is retained, including failures. No unfavorable trial was replaced or retried as part of the comparison.

All 15 agents finished within their limits with usage records. Product source, compiled output, measurement wrapper, runner, and frozen fixtures matched their recorded hashes when the study finished. The study used commit `be89b0b1dcda4b549df2349c365d170848be9ecf`. Subsequent reference repairs are separate from the frozen study.

## Original results

`Native` has no Jev MCP; `Optional` exposes it without requiring a call; `Guided` requires one context call before broad reads. Primary acceptance is only the original check set. It does not include later audit findings.

| Level  | Arm / run  | Primary acceptance | Main input | Cached input subset | Main output | Seconds | Jev evaluations |
| ------ | ---------- | -----------------: | ---------: | ------------------: | ----------: | ------: | --------------: |
| Low    | Native 1   |                3/3 |    125,043 |             110,080 |       1,575 | 130.246 |               0 |
| Low    | Native 2   |                3/3 |    124,351 |             110,592 |       2,343 |  97.248 |               0 |
| Low    | Optional 1 |                3/3 |    123,678 |             102,528 |       2,032 |  90.840 |               0 |
| Low    | Optional 2 |                3/3 |    125,528 |             104,576 |       2,161 |  84.872 |               0 |
| Low    | Guided     |                3/3 |    132,153 |             116,992 |       2,222 |  96.572 |               1 |
| Medium | Native 1   |                8/8 |    214,726 |             184,704 |       7,533 | 263.538 |               0 |
| Medium | Native 2   |                8/8 |    248,222 |             210,560 |       7,563 | 267.822 |               0 |
| Medium | Optional 1 |                8/8 |    165,929 |             130,304 |       7,778 | 265.512 |               0 |
| Medium | Optional 2 |                8/8 |    207,402 |             170,752 |       8,696 | 287.858 |               0 |
| Medium | Guided     |                6/8 |    277,613 |             241,280 |       6,902 | 334.696 |               2 |
| High   | Native 1   |              14/14 |    226,994 |             186,368 |      12,431 | 399.161 |               0 |
| High   | Native 2   |              14/14 |    334,259 |             276,992 |      14,151 | 488.569 |               0 |
| High   | Optional 1 |              14/14 |    272,232 |             239,616 |      12,064 | 415.247 |               0 |
| High   | Optional 2 |              14/14 |    218,372 |             167,808 |      13,311 | 441.622 |               0 |
| High   | Guided     |              14/14 |    305,387 |             246,400 |      12,151 | 424.526 |               4 |

Fourteen of fifteen original patches passed primary acceptance. After the additional tenant-key audit, five high patches were also rejected. Nine of fifteen original patches therefore passed all checks applied to their level. This is a review outcome on these tasks, not a population accuracy estimate.

## Token and provider accounting

Input includes repeated context across calls. Cached input is a subset of input, not another quantity to add. Reasoning output, when reported, is a subset of output. Nominal main-agent tokens below mean input plus output; this is not dollar cost and does not equate different model tokenizers or prices.

| Level  | Native mean nominal tokens | Guided nominal tokens | Guided difference | Reported Jev input / output |
| ------ | -------------------------: | --------------------: | ----------------: | --------------------------: |
| Low    |                    126,656 |               134,375 |            +6.09% |                 1,555 / 112 |
| Medium |                    239,022 |               284,515 |           +19.03% |                 3,359 / 206 |
| High   |                  293,917.5 |               317,538 |            +8.04% |                 6,368 / 358 |

These single guided observations cannot establish a causal penalty or benefit. Optional-arm differences cannot be attributed to Jev inference because those agents never called it. No paired comparison qualified for an inference-benefit claim.

The guided agents made three MCP context calls, resulting in seven successful Jev evaluations and eight HTTP attempts. One medium evaluation retried. Successful responses reported 11,282 Jev input tokens, 676 output tokens, charged gateway cost `0`, and market cost `0.000473844`. These are provider-reported successful-response observations; they do not independently audit billing for a failed HTTP attempt or establish future pricing. Main-agent dollar cost was unavailable. Review, orchestration, and reference-repair effort outside the measured CLI runs is not included in their usage.

## Context and failure analysis

The low context call returned five of six chunks and identified the omitted formatting helper through a recovery reference. The medium and high calls returned all eleven and nineteen chunks respectively. Each guided agent subsequently read the source with native tools. In these small repositories, the MCP added selection and metadata without eliminating broad source reads.

The medium failure was an extra `event` property in the existing four-field failure result. Both failing external checks compare that public shape. Jev returned `src/attempts.mjs` and all other requested chunks; the agent also read that source directly. The record does not support blaming omitted context for the defect. The failed patch remains in the original results, and its separate repair is recorded below.

## Independent review and reference corrections

The four-group high contract audit was committed at `f0a9944` before reviewing the high solutions. It checks invalid requests before mutation, a second reservation for the same order, stability of the original reserve result after checkout, and complete rollback. All five high candidates passed it. The frozen reference failed input validation, demonstrating that primary acceptance was incomplete even for the reference.

A later source review discovered separator-sensitive tenant keys. The additional two-case audit was defined after inspecting candidate code and is explicitly a post-review check, not part of the original scores. The optional and guided candidates retained ambiguous reservation/idempotency keys. Native candidates escaped keys but failed to preserve the existing flattened initial-stock input for separator-containing tenants. All five were rejected by this audit.

The current reference now validates requests before mutation and uses unambiguous internal reservation/idempotency identities. Root validation passed the original 14 tests, four contract groups, and two tenant-key checks. The obsolete reference file was removed. The original reference and scores remain recoverable from the frozen study commit.

The legacy initial-stock object itself uses flattened `tenant:sku` strings and cannot represent every ambiguous tenant/SKU pair. This benchmark does not establish a general production inventory API for arbitrary identifiers. The new audit uses distinct, representable stock keys; it verifies reservation and idempotency isolation without redesigning that public input.

## Rework and retained evidence

Rejected guided medium and high solutions were copied to separate workspaces for correction with explicit review feedback. These are supervised repairs, not new paired trials. Their extra model usage and acceptance results are stored separately in `rework/`; they never replace original failures or establish a Jev benefit. The other rejected high candidates remain as evidence, not approved examples.

| Supervised repair | External result                              | Additional input | Cached subset | Additional output | Seconds |
| ----------------- | -------------------------------------------- | ---------------: | ------------: | ----------------: | ------: |
| Medium guided     | 8/8 primary                                  |          141,556 |       123,136 |             3,041 |     153 |
| High guided       | 14/14 primary, 4/4 contract, 2/2 tenant keys |          183,077 |       156,032 |             5,205 | 235.315 |

Both repairs used the same main model and effort, without Jev. Their additional nominal main tokens were 144,597 and 188,282. Including the original guided attempt, the respective totals become 429,112 and 505,820, before orchestration or review overhead. This is the cost of explicit feedback and rework, not a comparison proving which tool caused the original mistake.

The [result directory](results/2026-09-22/complexity/) contains the frozen protocol, original report, usage summary, CSV, hash verification, source patches, exact task prompts, primary acceptance output, provider telemetry, secondary audits, and corrected-reference validation. `primaryAcceptancePass` in the summary means the original tests only; `qualityPass` is a compatibility alias with the same limited meaning. Consult the secondary audit files and this review before interpreting patch quality.

`command-review.json` records completed commands and MCP context coverage. Review found workspace source/test operations and unsuccessful local Git status probes, with no explicit credential reads or unrelated network commands in those records. Environment whitelisting and prompts are not a proof of hostile-agent isolation. Raw local CLI traces are retained outside the repository; their hashes and final workspace hashes are recorded in `trace-manifest.json`. Credentials and user configuration are excluded from deliverables.

## Reproduce and limits

Use the [benchmark protocol](../bench/complexity/README.md). For the historical study, check out the frozen commit, create a workspace from the matching seed, and apply its `solution.patch` with `git apply`. Run the frozen external acceptance suite using `BENCH_WORKSPACE`. Secondary audits use the same variable and remain separate from primary scores. The current reference is a post-study repair, so a fresh run on current main is a new study.

```sh
python3 scripts/summarize-complexity.py --report /absolute/report.json --output /absolute/new-summary
BENCH_WORKSPACE=/absolute/candidate node bench/complexity/audits/high-contract.mjs
BENCH_WORKSPACE=/absolute/candidate node bench/complexity/audits/high-tenant-keys.mjs
```

Only three synthetic repositories and two native/optional repetitions were tested. Timing shares a host with concurrent work. The study measures resulting patches and observed tool use, not intelligence, all reasoning quality, or guaranteed context preservation. Larger representative repositories, independently specified contracts, successful client adoption, and net cost measurements are still required before approving a general savings claim.

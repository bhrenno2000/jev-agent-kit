# Coding tasks across three complexity levels

This benchmark tests complete coding trajectories, not just Jev answers. All tasks and checks are authored synthetic fixtures. Complexity is defined by the interacting behavior that must be repaired, not by padded file size.

The [completed study](../../docs/complexity-study.md) retains all 15 original trials, failures, post-review checks, and supervised repairs. Its frozen commit predates the current reference corrections. The current runner records `invalid_integrity` before aggregation if source, build, frozen fixtures, runner, or measurement wrapper change during a study.

| Level  | Task                          | Main interactions                                                                       | External target checks |
| ------ | ----------------------------- | --------------------------------------------------------------------------------------- | ---------------------- |
| Low    | Cursor pagination             | Initial request, cursor continuation, limits, immutable responses                       | 3                      |
| Medium | Event delivery                | Retry limits, capped backoff, dedupe, persistence failures, transport mutation          | 8                      |
| High   | Tenant inventory and checkout | Concurrency, tenant boundaries, idempotency, rollback, outbox atomicity, stable retries | 14                     |

Seeds intentionally fail. Acceptance checks are outside the agent workspace and import only the candidate. Reference implementations stay outside that workspace. Before a live study, the runner copies each seed, applies its reference overlay, and requires the same acceptance suite to fail on the seed and pass on the reference. Authored expectations are reviewed before any model trial.

## Frozen protocol

For every task, run two paired repetitions of native tools versus optional MCP availability, reversing order for the second pair. Run one additional guided diagnostic per task, explicitly requesting a context call before broad source reading. That is 15 trajectories total. The guided arm measures explicit use; it is not the recommended default policy.

Keep the main model and reasoning effort identical across arms. This study preserves the user's configured `gpt-6-astra` and `xhigh` settings. Each trajectory gets a fresh identical seed, the same task and public tests, and the same time limit for its level. The agent retains ordinary search, reads, editing, reasoning, and tests. It cannot see the reference through MCP because the root is pinned to its workspace. The task manifest, including expected file hints, is removed from that workspace.

Limits are 240 seconds for low, 480 for medium, and 900 for high. Two workers may overlap; wall-clock observations therefore reflect a shared local host and are not isolated latency benchmarks. Completed, failed, timed-out, and protocol-noncompliant trials remain in the record. Trials are not retried merely because a result is unfavorable.

## Measurements and gates

- External acceptance checks determine patch correctness. A timeout or an unfinished agent run is not a completed delivery, even if the partial patch passes.
- Actual CLI usage separates input, cached input, uncached input, and output. Missing usage stays unknown. Cached input must not be added to input a second time.
- A measurement-only MCP wrapper records provider model, usage, retries, latency, and reported gateway cost without recording prompts, source, headers, or credentials. It uses the actual production client and server implementation.
- MCP calls and provider calls are separate counts. A single context call can make multiple provider requests.
- JSONL corruption or an unaccounted started request invalidates usage comparison. Partial/error usage remains a lower bound, never an assumed zero.
- Guided trials without an actual provider request are protocol failures and cannot establish a Jev inference benefit. Optional no-call trials are a valid adoption outcome but cannot establish that benefit either.
- Preserve all task requirements and original evidence. Acceptance coverage is a proxy for resulting behavior, not a measurement of the agent's intelligence or proof that every reasoning step was correct.
- Reject a savings claim when correctness regresses, records are incomplete, Jev was not used, or token differences are unsupported by the paired results. Main-agent dollar costs remain unknown unless supplied by the billing source.

Two repetitions on three authored tasks are exploratory. They do not establish population-level accuracy, statistical significance, or guaranteed savings on other repositories. Small files are a deliberate negative control: native tools may be the better choice.

## Reproduce

Development checks require Node.js 20.19+ and Python 3.9+. Live orchestration additionally requires an authenticated Codex CLI and macOS or Linux. It consumes model usage. Keep provider credentials in a protected file outside the repository.

Offline oracle validation, with no model calls:

```sh
python3 scripts/complexity-benchmark.py --output /absolute/new/preflight-directory --model gpt-6-astra --effort xhigh
```

Live study after building the adapter:

```sh
npm run build
python3 scripts/complexity-benchmark.py --output /absolute/new/study-directory --model gpt-6-astra --effort xhigh --key-file /absolute/private/vercel-key --run
```

Use the same selected model and effort throughout a comparison. The runner records CLI/Node versions, source/build/fixture hashes, the exact plan, prompts, JSONL traces, provider telemetry, acceptance output, timing, and final results. The output directory must be new. It does not overwrite prior studies or alter user client configuration.

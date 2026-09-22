# Validation record

Validated on September 22, 2026. This record distinguishes implementation checks from model-performance claims.

## Completed locally

- Strict TypeScript compilation and production build passed.
- The version 0.3.0 integrated suite passed 83 tests with no failures, skips, or cancellations on Node.js 20.19.4 and 22.23.2 on macOS; the release check also passed on Node.js 22.18.0.
- Source-comment policy passed for source, test, script, and fixture code.
- Dependency audit reported zero known vulnerabilities at the time of the check.
- The npm archive installed into an isolated global prefix and a separate project's dependencies. Both installation paths contained spaces.
- Both installed binaries completed MCP initialization, listed the expected tools, returned local status, and returned an explicit missing-credential error for inference calls.
- The generated Codex configuration was parsed successfully by the installed Codex CLI through a temporary command-line override. No user configuration was modified.
- Offline evaluation validates 12 authored decision cases and five source-selection cases. Its report correctly records model quality as `not_run`.

Tests cover provider wire shapes, malformed responses, distribution and usage validation, input complexity, bounded streaming responses, deadlines, retries, credential-file handling, filesystem containment, symlinks, binary and UTF-8 input, context budgets, source provenance, CLI behavior, MCP transport, and evaluation formulas. They establish the behavior tested; they are not an exhaustive security certification.

Version 0.3.0 adds tested structural parsing, import traversal, bounded evidence, unverified contracts, strict contract-file handling, receipt freshness, bounded cache reuse, optional semantic focus, failure fallback, MCP/CLI integration, and conservative three-arm benchmark accounting.

Version 0.2.1 additionally rejects credential-file symlinks and tests benchmark environment filtering and conservative usage accounting. Credentials are opened with no-follow semantics where supported, with a separate symbolic-link check. Invalid or missing usage is never converted into a zero-cost claim.

## Live validation

The Vercel TypeSafe-compatible endpoint successfully returned typed Jev answers using `typesafe-ai/jev`. The compiled CLI and an independent real MCP stdio client both completed successful inference. An earlier request was blocked by Vercel account verification; after the account/key update, calls succeeded.

The revised authored decision corpus completed all 12 requests with zero transport errors. It contains 13 graded answers and one ungraded Score answer. The policy matched 12/13 expected answers, returned 11/13 decisive answers, and abstained on the SQL-construction risk (`noul=0.74`). One correctly unknown Choice also abstained. Median process-level latency was 678 ms. Provider usage was 4,229 input and 392 output tokens. The gateway reported total charged cost `0` and market cost `0.000177618` for these 12 calls; these are recorded observations, not a future pricing guarantee.

The initial SQL state did not explicitly describe unsafe construction, so its expected-positive label was under-specified. The revised fixture supplies that evidence and separately checks whether tests executed the function. The initial report is retained alongside the revised report; thresholds were not tuned to obtain a passing score. [Initial decisions](results/2026-09-22/vercel-evaluation.json), [revised decisions](results/2026-09-22/vercel-evaluation-revised.json), [MCP transport result](results/2026-09-22/vercel-mcp.json).

The first source-selection run retained expected evidence for four cases. The split-function fixture made zero provider calls because it contained a line exceeding its 512-byte chunk cap. This was a defective split-boundary test, and its original result is retained. On these tiny files, response metadata and MCP compatibility serialization were larger than raw candidate source. This supports the native-read guidance; it does not measure real agent savings. [Initial context observations](results/2026-09-22/vercel-context.json).

After correcting the split fixture, all five context cases returned every expected evidence line. File precision was `0.5` for the exact-symbol distractor and `1.0` for the remaining cases. All five requests succeeded. This is a small authored positive corpus, not proof of production recall. [Revised context observations](results/2026-09-22/vercel-context-revised.json).

A two-task coding-agent adoption pilot ran each task with and without the MCP available. All four resulting patches passed independently executed acceptance checks. Neither treatment agent invoked Jev, and token changes went in both directions. Therefore the pilot does not demonstrate a Jev inference benefit, task-quality improvement, or net cost reduction. [Pilot protocol](../bench/agent-pilot/README.md), [pilot observations](results/2026-09-22/coding-agent-pilot.json).

The subsequent [15-run low/medium/high study](complexity-study.md) completed with verified source/build/fixture integrity. Fourteen original patches passed primary acceptance; later contract review rejected five high solutions as well. Nine original patches passed all checks applied to their level. Optional agents made no Jev calls. Guided agents used Jev, then read source natively; their nominal main-agent token totals were above the corresponding native means. Medium and high guided failures were retained and repaired separately with additional usage recorded. These results reject a general savings or mandatory-use recommendation.

The separate [advisory-verifier experiment](verification-study.md) completed 24 main review trajectories and four supplementary clean-input controls. All 28 passed external acceptance, with native and assisted review tied at 14/14. In the 24-run main cohort, assisted main-agent nominal tokens were 5.40% lower overall but 8.75% higher on the high-complexity task. Jev usage is recorded separately. The clean controls also showed token differences in both directions. Source, build, wrapper, runner, and frozen fixture integrity passed; every exported patch reproduced its exact final workspace hashes and acceptance outcome. The experimental tool is not part of the installed production MCP.

Direct verifier capability testing produced 96 judgments. An independently identified input-domain ambiguity is retained in the original labels and excluded only in a disclosed post hoc sensitivity analysis. The 88-judgment subset had 38 decisive label matches and 50 abstentions under the fixed thresholds. These observations establish neither greater delivery accuracy nor calibrated confidence or general savings.

The [36-trajectory structural preparation study](optimization-study.md) completed all low, medium, and high tasks with native, local-prepared, and Jev-prepared arms. All original acceptance runs passed; later review exposed a real high-reference defect. Applying the disclosed additional case to every high output left native at 12/12 and both prepared arms at 10/12 across all checks applied. Four rejected outputs were repaired separately, with original failures and additional usage preserved. All 36 original patches and four repair patches reproduced their recorded file hashes and test outcomes.

Prepared main-agent nominal tokens were 27.02% above native; Jev-prepared tokens were 31.39% above native, plus eight remote calls. Including separate repairs increases those differences to 43.97% and 49.36%. Seven Jev decisions abstained and one returned a focus; four low tasks skipped inference. These results reject mandatory preparation as a quality or savings default. The current reference and acceptance suite are corrected; frozen historical inputs and scores remain intact.

## Remaining gates

GitHub Actions did not execute the matrix on the initial commit: [run 35693519840](https://github.com/bhrenno2000/jev-agent-kit/actions/runs/35693519840) ended with `startup_failure`, an empty workflow name, `path: BuildFailed`, no jobs, and no downloadable logs. The real `CI` workflow is registered as active and repository Actions permissions are enabled. Re-running that failed run is rejected by GitHub. This establishes that remote checks did not run; it does not establish the underlying service or account cause.

A direct manual dispatch of the registered `CI` workflow reproduced the failure: [run 35693726823](https://github.com/bhrenno2000/jev-agent-kit/actions/runs/35693726823) resolved `.github/workflows/ci.yml` correctly but still ended in `startup_failure` with zero jobs. No account settings, permissions, billing, repository visibility, or runner infrastructure were changed to work around this condition.

- Direct TypeSafe-account validation; live successful inference here used Vercel.
- Independent labels and repeated paired trials on representative production repositories; the completed study covers only three authored tasks.
- Verified improvement in task success, total tokens, total cost, latency, and rework.
- Interactive adoption in the user's normal coding client and repositories.

The default direct TypeSafe route is covered by protocol tests; its live account path was not used. Successful live Vercel fixtures do not satisfy the representative whole-agent performance gates. Do not interpret the adapter as approved for automatic compression of every read.

## Reproduce

```sh
npm ci
npm run check
npm run evaluate
npm audit
npm pack
```

After configuring credentials for the selected provider outside the repository:

```sh
npm run evaluate -- --live
npm run evaluate -- --context-live
```

The CI workflow runs the offline checks on Linux, macOS, and Windows with Node.js 20 and 22. Check the workflow run associated with the exact commit for remote results; workflow configuration alone is not evidence that those jobs passed.

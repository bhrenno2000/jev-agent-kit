# Validation record

Validated on September 22, 2026. This record distinguishes implementation checks from model-performance claims.

## Completed locally

- Strict TypeScript compilation and production build passed.
- The integrated suite passed 34 tests with no failures or skipped tests on Node.js 22.18.0, and the same 34 tests passed separately on Node.js 20.19.4 on macOS.
- Source-comment policy passed for source, test, script, and fixture code.
- Dependency audit reported zero known vulnerabilities at the time of the check.
- The npm archive installed into an isolated global prefix and a separate project's dependencies. Both installation paths contained spaces.
- Both installed binaries completed MCP initialization, listed the expected tools, returned local status, and returned an explicit missing-credential error for inference calls.
- The generated Codex configuration was parsed successfully by the installed Codex CLI through a temporary command-line override. No user configuration was modified.
- Offline evaluation validated 12 authored synthetic cases. Its report correctly records model quality as `not_run`.

Tests cover provider wire shapes, malformed responses, distribution and usage validation, input complexity, bounded streaming responses, deadlines, retries, credential-file handling, filesystem containment, symlinks, binary and UTF-8 input, context budgets, source provenance, CLI behavior, MCP transport, and evaluation formulas. They establish the behavior tested; they are not an exhaustive security certification.

## Pending

GitHub Actions did not execute the matrix on the initial commit: [run 35693519840](https://github.com/bhrenno2000/jev-agent-kit/actions/runs/35693519840) ended with `startup_failure`, an empty workflow name, `path: BuildFailed`, no jobs, and no downloadable logs. The real `CI` workflow is registered as active and repository Actions permissions are enabled. Re-running that failed run is rejected by GitHub. This establishes that remote checks did not run; it does not establish the underlying service or account cause.

A direct manual dispatch of the registered `CI` workflow reproduced the failure: [run 35693726823](https://github.com/bhrenno2000/jev-agent-kit/actions/runs/35693726823) resolved `.github/workflows/ci.yml` correctly but still ended in `startup_failure` with zero jobs. No account settings, permissions, billing, repository visibility, or runner infrastructure were changed to work around this condition.

- An authenticated TypeSafe request using the configured model.
- Live evaluation of the authored synthetic corpus, including source-selection precision and recall.
- Independent labels for representative development tasks and repeated paired trials with the same main agent, repository snapshots, and stopping rules.
- Verified improvement in task success, total tokens, total cost, latency, and rework.
- Interactive adoption in the user's normal coding client and repositories.

No TypeSafe credential was available to the validation process. No live Jev accuracy or end-to-end token-saving percentage is reported. Software correctness tests and simulation fixtures cannot satisfy these pending model-performance gates.

## Reproduce

```sh
npm ci
npm run check
npm run evaluate
npm audit
npm pack
```

After configuring a TypeSafe credential outside the repository:

```sh
npm run evaluate -- --live
npm run evaluate -- --context-live
```

The CI workflow runs the offline checks on Linux, macOS, and Windows with Node.js 20 and 22. Check the workflow run associated with the exact commit for remote results; workflow configuration alone is not evidence that those jobs passed.

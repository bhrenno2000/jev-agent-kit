# Coding-agent adoption pilot

These are intentionally defective, dependency-free Node.js repositories. They are benchmark fixtures, not production application code. `seeds/*/task.txt` contains each task; public tests accompany the seed, and acceptance checks live outside it in `checks/`.

The September 22 pilot used Codex CLI 0.155.1 with its default model/settings and one run per arm. Each run received a fresh copy of the same seed. The baseline had no MCP server; treatment registered Jev Agent Kit with the candidate repository pinned as its root and the Vercel provider selected. The main model was not pinned or exposed in JSONL, so this pilot cannot establish reproducible model-specific performance.

Run order was refund baseline, refund MCP, authorization MCP, authorization baseline. Both arms were told to fix the task, preserve behavior, run tests, keep English source without comments, avoid parent directories and credentials, and avoid network access except through the provided MCP. The treatment additionally received the optional-use policy from `docs/agent-workflow.md`. It was not forced to invoke Jev.

The execution used `codex exec --ephemeral --ignore-user-config --sandbox workspace-write --skip-git-repo-check --json`. Each run had a 240-second limit. Acceptance tests were executed by the orchestrator after the coding agent finished, with the check imports pointed to that run's resulting source. Seed tests are expected to fail before a fix.

All four acceptance suites passed, and neither treatment called Jev. Aggregate input/output counts vary with the agent's trajectory and cache behavior. Those differences cannot be attributed to Jev inference. This is an adoption check showing that optional registration need not force tool use, not a token-saving benchmark. [Recorded observations](../../docs/results/2026-09-22/coding-agent-pilot.json).

For a stronger study, freeze the main model and agent version, retain repository hashes, use independently labeled representative tasks and repeated counterbalanced pairs, record actual MCP calls and cache-aware usage, and score resulting patches independently. Do not inspect external checks while performing a task. Include all failures and abstentions in the results.

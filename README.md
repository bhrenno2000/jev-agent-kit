# Jev Agent Kit

A completed experiment investigating whether TypeSafe Jev, integrated through a local Model Context Protocol (MCP) server and CLI, could help coding agents use fewer tokens and deliver more accurate code while preserving the context needed to reason about a task.

**Status: experiment concluded; retained for reference and reproduction.** This project is not being adopted in the author's development workflow. The repository preserves the implementation, research, benchmarks, original failures, and separate repairs. It is not an actively maintained product.

## Purpose and method

The hypothesis was that bounded source selection, structured evidence preparation, and advisory typed decisions could reduce unnecessary reading and mistakes enough to offset the extra calls and context. We built an installable MCP/CLI adapter and compared agent workflows on authored low-, medium-, and high-complexity programming tasks, keeping the requirements, model, and reasoning effort fixed within each study.

The latest experiment ran 36 trajectories: three task levels, defective and intended-correct inputs, three workflows, and two repetitions. It compared native work, local structural preparation, and the same preparation with selective Jev assistance. External acceptance tests, an additional disclosed review check, usage records, exact patches, and separate repair outcomes are preserved.

## Results and conclusion

The latest study did not demonstrate a quality or token-saving benefit that justified adoption for the evaluated task families.

| Workflow | Original acceptance | Passed all checks applied after review | Main-agent nominal tokens versus native |
| --- | ---: | ---: | ---: |
| Native | 12/12 | 12/12 | Baseline |
| Local preparation | 12/12 | 10/12 | +27.02% |
| Preparation with Jev | 12/12 | 10/12 | +31.39% |

Nominal tokens are main-agent input plus output, including cached input. Provider usage is recorded separately; token differences are not dollar differences. Four reviewed failures were repaired in separate runs. Including those repairs, the differences rose to +43.97% for local preparation and +49.36% for Jev preparation. The original failures remain visible.

These results are limited to three synthetic tasks with small active module graphs and two repetitions. The additional high-complexity check was discovered after inspecting a native solution and exposed a defect in the intended-correct reference itself. It was then applied equally to all high outputs. This post hoc result is not a preregistered estimate, and the study does not establish a universal conclusion about Jev. Receipt reuse and representative production repositories were not evaluated in this experiment.

Read the [full 36-trajectory study](docs/optimization-study.md), [earlier source-selection study](docs/complexity-study.md), and [advisory-verification follow-up](docs/verification-study.md) for methods, limitations, and preserved results. The implementation passed local checks and live Vercel calls; the [validation record](docs/validation.md) distinguishes those checks from performance claims and documents the remote CI startup failures observed during the experiment.

## Implementation retained for reproduction

Version 0.3.0 provides a local MCP server and CLI for selecting source excerpts, preparing exact structural evidence with an unverified acceptance checklist, and asking batched typed questions about supplied evidence. `jev_prepare` defaults to local parsing, supports versioned receipts, and optionally asks Jev for a reading priority while preserving the same evidence. See [structured workflow](docs/optimized-workflow.md).

The adapter runs locally. Jev inference runs through TypeSafe or Vercel AI Gateway. You need Node.js 20.19 or later and a key for live calls to the selected provider. The package is not published to npm. The instructions below are retained for inspecting the implementation and reproducing the experiment.

## Install

Clone the repository:

```sh
gh repo clone bhrenno2000/jev-agent-kit
cd jev-agent-kit
npm ci
npm run check
npm pack
```

Install the resulting archive globally:

```sh
npm install --global ./bhrenno2000-jev-agent-kit-0.3.0.tgz
jev-agent --version
jev-agent doctor
```

Or install that archive in a project's development dependencies, using its absolute path:

```sh
npm install --save-dev /absolute/path/bhrenno2000-jev-agent-kit-0.3.0.tgz
npx --no-install jev-agent --version
```

For repeatable installs, retain the archive or pin a Git commit. Do not use `npx jev-agent-kit`: there is no public package for this project.

## Credentials and registration

For Vercel, set `JEV_PROVIDER=vercel` and `AI_GATEWAY_API_KEY_FILE` to an existing local file containing only the key. Alternatively supply `AI_GATEWAY_API_KEY` in the process environment. For TypeSafe, use `JEV_PROVIDER=typesafe` with `TYPESAFE_API_KEY` or `TYPESAFE_API_KEY_FILE`. Provider selection is explicit; credentials never fall back across providers. Keep that file outside repositories with access restricted to your user. Never place the key in a tool argument, committed configuration, or chat message. The adapter does not automatically load `.env` files.

Generate a Codex configuration entry with an explicit project root:

```sh
jev-agent config --client codex --root /absolute/path/to/project
```

Merge the printed section into your user `~/.codex/config.toml`, or the trusted project's `.codex/config.toml`. Configuration generation prints text and never overwrites an existing configuration. The generated entry pins both the installed executable and the allowed root. A global package can serve several projects by registering distinct server names and roots.

For Claude Code or another client using `mcpServers` JSON:

```sh
jev-agent config --client claude --root /absolute/path/to/project
```

Merge the entry into the client's MCP configuration. The launching application must inherit the credential environment. GUI clients started outside your shell may not inherit shell variables; configure the credential file path in the client's local environment settings without embedding the key. Reconnect the client after registration.

Package installation makes the binary available; MCP registration makes its tools available. The agent still needs a policy for when to call them. See [agent workflow](docs/agent-workflow.md).

## Tools

| Tool           | Purpose                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `jev_prepare`  | Prepare exact JS/TS declarations, local imports, requirements, and versioned evidence; local by default    |
| `jev_context`  | Read explicit source paths under the pinned root and return relevant excerpts with provenance and coverage |
| `jev_evaluate` | Evaluate up to 24 atomic Noul, Choice, or Score questions against a bounded state                          |
| `jev_status`   | Inspect local configuration without making an API call                                                     |

Examples use synthetic, credential-free data:

```sh
jev-agent evaluate --input examples/triage.json
jev-agent evaluate --input examples/evidence.json
jev-agent context --root fixtures/context-repository --input examples/context.json
jev-agent prepare --root fixtures/context-repository --input examples/prepare.json
```

The same JSON objects are the arguments for the corresponding MCP tools. `--input -` reads JSON from stdin. Use exact searches for exact symbols; use Jev when the decision is semantic and all relevant facts are available.

Choice returns the selected label, distribution, and provider confidence. Score retains the provider's zero-based rubric scale. Noul is a yes probability and has no separate confidence. All results are advisory. A small result is not proof of correct code or sufficient evidence.

## Configuration

Vercel example, with a credential stored outside the repository:

```sh
export JEV_PROVIDER=vercel
export AI_GATEWAY_API_KEY_FILE=/absolute/private/path/vercel-key
jev-agent doctor
```

`doctor` checks local configuration only; it does not authenticate the key. Vercel can require account verification before serving requests. The adapter uses the documented [TypeSafe-compatible API](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe).

| Variable                  | Purpose                                                                          |
| ------------------------- | -------------------------------------------------------------------------------- |
| `JEV_PROVIDER`            | `typesafe` (default) or `vercel`                                                 |
| `AI_GATEWAY_API_KEY`      | Vercel credential                                                                |
| `AI_GATEWAY_API_KEY_FILE` | External Vercel credential file                                                  |
| `TYPESAFE_API_KEY`        | TypeSafe credential, preferred over a credential file                            |
| `TYPESAFE_API_KEY_FILE`   | Local key file, resolved when making a call                                      |
| `JEV_MODEL`               | Model identifier; TypeSafe defaults to `jev-1.13.0`, Vercel to `typesafe-ai/jev` |
| `JEV_TIMEOUT_MS`          | Total evaluation timeout, 100–60000 ms; default 30000                            |

Each provider has a fixed official HTTPS destination. Tool inputs cannot change it. There is no production mock mode, automatic shell execution, persistent source cache, or automatic repository upload. `serve --root PATH` requires an explicit root.

## Validation and limits

Development checks require Python 3.9+ in addition to Node.js. The installed MCP runtime only requires Node.js. The [complexity benchmark](bench/complexity/README.md) defines low, medium, and high coding tasks with independent acceptance checks.

```sh
npm run check
npm run evaluate
npm run evaluate -- --live
```

The default evaluation is offline fixture validation. Live mode calls the selected provider with the committed synthetic corpus and requires credentials. Offline tests use explicit local HTTP stand-ins and exercise the real MCP transport; they do not measure Jev accuracy.

This release does not claim a measured reduction in whole-agent tokens or improved code-delivery accuracy. Those claims require paired agent trajectories on representative work. Incomplete context, low-confidence results, and provider failures must lead the agent to gather more evidence or use ordinary tools. See [competitor research](docs/competitors.md), [evaluation](docs/evaluation.md), [research](docs/research.md), [architecture](docs/architecture.md), and [security](docs/security.md).

Source code and documentation are in English. Source files contain no comments. The npm manifest retains `private: true` to prevent npm publication and `license: "UNLICENSED"`; repository visibility does not change those package settings.

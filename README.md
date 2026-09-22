# Jev Agent Kit

Local MCP server and CLI for using TypeSafe Jev inside a coding workflow. Select relevant source excerpts before loading them into an agent's context, or ask batched typed questions about explicit evidence.

Version 0.3.0 adds structural evidence preparation with an explicit acceptance checklist. `jev_prepare` defaults to local parsing, supports versioned receipts, and optionally asks Jev for a reading priority while preserving the same evidence. See [structured workflow](docs/optimized-workflow.md) and the [36-trajectory study](docs/optimization-study.md). The new study found 31.39% more nominal main-agent tokens with Jev preparation and four post hoc failures across the two prepared arms; mandatory use is not approved.

Status: the adapter passes local checks and live Vercel calls. The [source-selection study](docs/complexity-study.md) and [advisory-verification follow-up](docs/verification-study.md) retain outcomes, limitations, and rework. The follow-up found equal tested quality and variable token differences; mandatory use and general savings claims are not approved. See the [validation record](docs/validation.md).

The adapter runs locally. Jev inference runs through TypeSafe or Vercel AI Gateway. You need Node.js 20.19 or later and a key for the selected provider. The repository is private and the package is not published to npm.

## Install

With access to this private repository:

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

For repeatable installs, retain the archive or pin the private Git commit. Do not use `npx jev-agent-kit`: there is no public package for this project.

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

Source code and documentation are in English. Source files contain no comments. The package is private and unlicensed for redistribution.

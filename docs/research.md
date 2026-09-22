# Research and product decision

Researched on September 22, 2026 against TypeSafe and OpenAI documentation. Working identification: TypeSafe AI Jev.

## What Jev does

Jev accepts a state and independent typed questions. Choice selects a label, Noul returns a yes probability, and Score evaluates an ordered rubric. Questions share state and are evaluated independently. The application composes their answers into a workflow. This is useful for small semantic judgments where all necessary evidence is present. [TypeSafe introduction](https://docs.typesafe.ai/introduction)

Jev does not write patches, execute tools, plan a development project, or replace the model behind a coding agent. An MCP integration makes Jev callable by that agent; installing it does not automatically change the agent's reasoning or token consumption. [Jev with coding agents](https://docs.typesafe.ai/introduction/coding-agents)

Choice and Score confidence describe the concentration of a probability distribution. Confidence is not interchangeable with the winning label's probability. Noul has no separate confidence field. Thresholds need validation on the intended question family and model version. [Confidence](https://docs.typesafe.ai/confidence)

The model has documented weaknesses with arithmetic, dates, multiple reasoning hops, irrelevant context, and adversarial content. State can influence judgments through prompt injection. Keep calculations and permission enforcement in deterministic code, retain original evidence, and review uncertain classifications. [Model limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

The implementation pins `jev-1.13.0` by default. The vendor currently lists text input, a 64k total context limit, a 32k state-plus-longest-question limit, and input-only billing. These provider limits and prices can change; local byte caps are deliberately smaller and are not token estimates. [Models](https://docs.typesafe.ai/models)

## Where it fits this development workflow

| Step                                             | Appropriate implementation                  | Expected benefit to verify                            |
| ------------------------------------------------ | ------------------------------------------- | ----------------------------------------------------- |
| Locate an exact symbol                           | `rg`, language server, compiler             | Exact, inexpensive lookup                             |
| Select relevant code from a short candidate list | `jev_context`                               | Avoid loading irrelevant source into the main agent   |
| Classify several diagnostic records              | Batched Choice questions in `jev_evaluate`  | Compact typed categories with uncertainty             |
| Match a claim to supplied evidence               | Atomic Noul questions in `jev_evaluate`     | Additional evidence signal before independent review  |
| Choose among known specialist routes             | Choice with an explicit unknown route       | Bounded routing when the choice is genuinely semantic |
| Implement or debug across several dependencies   | Main coding agent plus compiler/tests       | Multi-step reasoning and source changes               |
| Approve a release                                | Independent review and deterministic checks | Reproducible acceptance evidence                      |

This project's principal hypothesis is that local source selection can prevent irrelevant code from entering the main model's context. A generic wrapper that asks the agent to paste source it has already read has weaker token-saving potential. The hypothesis remains unproven until paired real-agent trials are available.

## Why MCP plus CLI

MCP provides discovery and a standard tool-call interface for coding clients. CLI access supports shell workflows and reproducible experiments using the same implementation. Codex supports local STDIO MCP servers and user or trusted-project configuration. Package installation and client registration are separate steps. [Official Codex MCP documentation](https://developers.openai.com/codex/mcp)

Three tools keep the interface small: a local status check, source context selection, and a typed evaluator. The server cannot modify files, run commands, or grant permissions. It sends explicitly selected content to the configured TypeSafe or Vercel provider over HTTPS; it does not run the Jev model locally.

## Build versus reuse

We found community wrappers including [rashedInt32/jev-mcp](https://github.com/rashedInt32/jev-mcp), [FrancoisChastel/jev-code](https://github.com/FrancoisChastel/jev-code), and [BorisLeMeec/jev](https://github.com/BorisLeMeec/jev). Their existence supports feasibility, not their correctness or suitability for this workflow. TypeSafe also maintains an [agent skill](https://docs.typesafe.ai/agent-skill) for agents writing applications that use Jev.

The custom implementation focuses on bounded local file access, source provenance, explicit coverage gaps, strict provider validation, portable installation, and an independently exercised MCP interface. No community implementation code is copied. A plugin or automatic read interceptor is deliberately deferred until retrieval quality has been measured: filtering every read can hide necessary evidence.

## What is and is not established

Protocol, input/output validation, filesystem boundaries, packaging, and failure handling can be tested without a live model. Such tests establish wrapper behavior. They do not establish Jev's classification quality, calibration, or task success.

A live synthetic corpus can expose integration defects and obvious classification failures. It cannot establish production accuracy. A representative, labeled development corpus and paired agent trajectories are required to claim token or cost savings. Count the main agent's schemas, prompts, cached and uncached input, output, tool calls, retries, Jev usage, and rework. Preserve quality and missing-evidence rates alongside cost. See [evaluation](evaluation.md).

There is no universal token-saving percentage and no claim of perfect code delivery. Larger reductions in tool-result size can coexist with higher total cost or worse recall. The correct acceptance criterion is less total work at equal or better task success on the workflows where the tool is enabled.

A source-level comparison and the decisions adopted from direct and adjacent tools are recorded in [competitor research](competitors.md).

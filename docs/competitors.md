# Competitor research and design decisions

Reviewed on September 22, 2026. Public source and documented experiments establish mechanisms and limits; they do not establish that another project's savings transfer to this adapter.

## Direct Jev integrations

| Project                  | Useful mechanism                                                                  | Observed limitation                                                                                          | Decision here                                                                          |
| ------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| BorisLeMeec/jev          | Declaration-first search, full-source verification, explicit read fallback        | Its author reports cross-file answer binding failures and loss of 3 of 11 targets when splitting large files | Preserve source identity, test evidence recall, avoid automatic read replacement       |
| FrancoisChastel/jev-code | Shared CLI/MCP core, typed questions, uncertainty policy, distributions and usage | Caller supplies evidence; a one-off judgment can cost more than using the main agent directly                | Keep one typed evaluator, return uncertainty, reserve it for useful repeated judgments |
| rashedInt32/jev-mcp      | Server-side path reads, bounded triage, per-item errors, validated answers        | One MCP invocation can still make many inference requests                                                    | Report actual calls and usage; retain explicit filesystem and request boundaries       |

Boris' published agent experiments use small paired samples, and its reported wall-clock benefit is inconsistent. They are useful hypotheses, not a transferable percentage. Its source also explains why reducing a file to declarations can lose implementation evidence. [Implementation](https://github.com/BorisLeMeec/jev/blob/e81c1d006b8b23a616486610f311039088521d0c/internal/run/find.go), [retrieval experiments](https://github.com/BorisLeMeec/jev/blob/e81c1d006b8b23a616486610f311039088521d0c/bench/RESULTS.md), [paired timings](https://github.com/BorisLeMeec/jev/blob/e81c1d006b8b23a616486610f311039088521d0c/bench/TIMING.md).

Jev-code's abstention and review policies are more useful than a forced best label when evidence is weak. Its documentation explicitly limits the case for replacing ordinary model judgment. [Policy](https://github.com/FrancoisChastel/jev-code/blob/051b492a201d5fe97dd26c422dcc5d7ed24b033c/src/tools/policy.ts), [usage guidance](https://github.com/FrancoisChastel/jev-code/blob/051b492a201d5fe97dd26c422dcc5d7ed24b033c/skills/jev/SKILL.md).

The closest comparison to our source reader is rashedInt32/jev-mcp. Its containment checks, response validation, and distinct item errors provide concrete engineering lessons. We keep whole-call errors for a failed context inference rather than return a partly scored set that could look complete. [Source access](https://github.com/rashedInt32/jev-mcp/blob/ad00bf8a74f5111915fedfbbab1681ed56c3d49a/src/files.ts), [triage implementation](https://github.com/rashedInt32/jev-mcp/blob/ad00bf8a74f5111915fedfbbab1681ed56c3d49a/src/index.ts).

## Adjacent approaches

**Serena** retrieves symbols, references, and implementation details through language servers and MCP. This is complementary: exact structural facts should use deterministic or language-server tools before a probabilistic relevance judgment. Its capability matrix documents backend differences. Its v2 REPL approach is documented as beta; reducing tool-schema overhead is a useful lesson without copying an entire execution runtime. [Tools and APIs](https://oraios.github.io/serena/01-about/035_tools.html), [source snapshot](https://github.com/oraios/serena/tree/6707cd9b7efbaea1435fb7bfd7ff20d4b5916983).

**Aider** builds a tree-sitter repository map and ranks structural information under a token budget. The map guides subsequent full reads. The lesson is progressive disclosure with paths and symbols, while preserving a way to obtain actual implementation evidence. A map also costs recurring context and must stay current after changes. [Repository map](https://aider.chat/docs/repomap.html), [design](https://aider.chat/2023/10/22/repomap.html).

**RTK** compresses command output. Its own accounting distinguishes output-byte reduction from whole-agent billing. A controlled JetBrains experiment found higher cost at low reasoning effort and essentially unchanged cost at high effort in its particular Claude Code/SkillsBench setup, with unchanged quality. Extra turns, normal tool truncation, and cached-input pricing explain why a smaller output can fail to save money. This is evidence against universal savings claims, not a universal verdict on RTK. [RTK accounting](https://github.com/rtk-ai/rtk/blob/b748a5f75563f410103551689097650be7210d99/docs/guide/resources/savings-explained.md), [JetBrains experiment](https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/).

## Applied changes

- Three MCP tools keep registration small. The server gives short guidance for when ordinary reads are preferable.
- Exact source excerpts retain relative paths, line ranges, and SHA-256 digests. No generated summary substitutes for source.
- Round-robin candidate allocation prevents one large file from consuming every chunk slot when several candidates fit the file budget.
- Duplicate paths do not trigger duplicate evaluations.
- Low relevance and output-budget omissions get recovery references, explicit counters, and `incomplete: true`. Recovery metadata has its own omission counters.
- Scores below `0.8` remain marked uncertain. The retention cutoff is `0.2`; these are authored policies, not calibrated guarantees for private repositories.
- Credentials are selected explicitly by provider. Vercel and TypeSafe keys never cross-fallback.
- The evaluation records real provider usage separately from approximate context tokens. Provider-reported gateway billing is retained when available.

## Rejected defaults and remaining gates

Do not intercept every file read, discard conversation history, summarize requirements, route all reasoning through Jev, or let a score approve a release. A context lookup is optional, and the coding agent retains its usual search, reads, reasoning, editing, tests, and review.

Batching shares state and can misattribute evidence across chunks. Explicit indexed questions reduce ambiguity but do not prove the problem solved. Test split functions, callers, distractors, negative controls, and embedded instructions against expected line evidence before trusting a task family.

The release gate is a paired task comparison: equal repository snapshots, main model, task, checks, and stopping rules; then compare task success, missing evidence, total input/output tokens, cache usage, Jev usage, costs, retries, elapsed time, and rework. Tool-output compression alone cannot pass that gate. Keep adoption opt-in until the representative task family passes.

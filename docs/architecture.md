# Architecture

```mermaid
flowchart LR
  A[Coding agent] --> B[MCP or CLI]
  B --> C[Strict input validation]
  C --> D[Bounded local source reader]
  C --> J[Local declarations and acceptance checklist]
  J --> H
  J --> K[Optional semantic focus]
  K --> E
  C --> E[Typed evaluation request]
  D --> E
  E --> F[TypeSafe or Vercel HTTPS API]
  F --> G[Response validation]
  G --> H[Typed answers or source excerpts]
  H --> A
  A --> I[Read full evidence, edit, test, review]
```

The root is pinned when the server starts. Tool callers supply relative file names; they cannot switch the root or the API destination. The context tool reads a bounded candidate list and presents chunks to Jev, then returns selected excerpts and provenance. An omitted excerpt is not evidence that a feature is absent.

Chunks end at line boundaries and do not overlap. CRLF is normalized to LF in returned excerpts, and the digest identifies the returned excerpt. A definition split across a boundary may need a wider follow-up read. Files are admitted in caller order, then chunk slots are allocated round robin across admitted files. Evaluated excerpts are ranked before applying the output budget. Current limits are 24 evaluated chunks per call, six per request, 24 KiB per state, and 16 KiB for the context result object. MCP's text and structured representations add serialization overhead.

The provider client shares one contract across CLI, MCP, context selection, and evaluation. It checks request sizes and question schemas before remote inference. It checks answer IDs, answer types, distributions, and values after inference. A malformed answer becomes an error, never a positive decision.

Credentials are resolved outside tool arguments. Each selected provider has a fixed production endpoint. Constructor injection exists for library tests, where a local HTTP stand-in exercises the actual request/response protocol. Test doubles are isolated from production configuration.

Every evaluated but withheld excerpt gets a recovery reference while the metadata budget permits it. The response separately counts filtered, budget-omitted, unscanned, and skipped evidence. Metadata omissions are explicit. `incomplete` describes withheld source evidence, not just transport success.

The adapter does not persist source contents, prompts, results, or credentials. The preparation tool has an explicit process-local decision cache with 32 entries and a five-minute lifetime. Every request rereads source and validates the snapshot; only an acknowledged matching receipt suppresses repeated source output. Contract, source, query, policy, and provider/model changes invalidate reuse. Context selection and generic evaluation remain uncached. See [structured workflow](optimized-workflow.md).

Model output is advisory. The orchestrator decides whether to read more evidence, use a specialist, or run a test. No model answer can expand the filesystem root, change the provider URL, execute a command, or bypass a deterministic validation failure.

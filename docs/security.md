# Security and data handling

## Trust boundaries

The MCP client starts a local adapter with an explicit filesystem root. `jev_context` reads caller-selected paths within that root. `jev_evaluate` receives caller-supplied state. Both send relevant request content to `https://api.typesafe.ai/v1/systemone`. The provider's data-handling terms apply to those requests. The adapter is not a local model and does not provide zero data retention guarantees on the provider's behalf.

Neither tool writes source files, runs shell commands, changes permissions, or approves actions. Jev's response cannot change the root or destination. Tool annotations describe this behavior but are not an authorization mechanism.

## Credentials

Supply the key through `TYPESAFE_API_KEY`, or an external credential file selected by `TYPESAFE_API_KEY_FILE`. Direct environment credentials take precedence. Restrict file access to your user and keep keys outside repositories. The adapter does not load arbitrary `.env` files or return key values through status and error responses.

The SDK constructor permits an explicit alternate destination for testing or deliberate library integration. MCP and CLI users cannot choose an alternate destination through tool inputs or environment variables. Do not pass a production key into a test client. Tests use synthetic credentials and loopback servers.

## Source access

The source reader rejects traversal, symbolic links in candidate paths, unsupported/binary files, common sensitive names, and excluded generated/dependency directories. It imposes file, chunk, state, and output limits and reports omitted evidence. These are conservative access boundaries, not comprehensive secret detection: a credential embedded in an ordinary source file may still be sent. Select only content you are permitted to submit to TypeSafe.

The operating system and files within the pinned root remain trusted local infrastructure. File identity checks reduce races, but the adapter is not a hardened operating-system sandbox against a hostile local process continuously replacing filesystem objects. Run it with the same least privilege you use for development.

## Model output

Request schemas and provider responses are validated. Unexpected answer IDs, invalid distributions, unknown choice labels, missing usage, invalid JSON, timeouts, and provider failures produce errors. Large inputs are rejected or explicitly omitted instead of being silently treated as complete evidence.

Prompt injection can still influence a relevance score or classification. The model's inability to execute tools limits direct effects, but an agent that blindly trusts a score can make a bad decision. Treat returned content as untrusted source text and verify important findings against the original files and deterministic checks.

## Logging and retention

The adapter emits result JSON and bounded errors. It does not maintain a source database, persistent result cache, telemetry endpoint, or request log. Your MCP client, terminal, CI system, and inference provider may retain their own records. Review those systems separately.

## Reporting a defect

Report privately to the repository owner. Include the affected version, a synthetic reproduction, expected behavior, and observed behavior. Do not include live API keys or private source. Disable the MCP server in the client while investigating an access-boundary defect.

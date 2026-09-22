import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { JevClient, JevError, evaluationInputSchema } from "./core/index.js";
import { collectContext, contextInputSchema, type ContextInput } from "./context.js";
import { VERSION } from "./version.js";
import { EvidencePreparer, prepareInputSchema } from "./prepare.js";

function json(value: Record<string, unknown>): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const text = JSON.stringify(value);
  return { content: [{ type: "text", text }], structuredContent: value };
}

function failure(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const code = error instanceof JevError ? error.code : "tool_error";
  return { content: [{ type: "text", text: JSON.stringify({ error: code }) }], isError: true };
}

export function createServer(client: JevClient, root: string): McpServer {
  const preparer = new EvidencePreparer(client);
  const server = new McpServer(
    { name: "jev-agent-kit", version: VERSION },
    {
      instructions:
        "Prefer native search and reads for exact symbols, small files, and known context. Use jev_prepare for bounded JS/TS declaration evidence and explicit acceptance requirements; local mode needs no inference. Its source blocks are exact evidence, so expand reads when context is omitted, stale, or insufficient. Only supply a prior receipt if its evidence is still available to you. Use jev_context for uncertain relevance in explicit source paths, and jev_evaluate for bounded advisory decisions. Inspect coverage and recovery references. Never replace reasoning, tests, or permissions with a score.",
    },
  );
  server.registerTool(
    "jev_prepare",
    {
      description:
        "Read bounded JS/TS declarations and local imports with an explicit acceptance checklist. Local mode needs no provider. Jev mode optionally suggests a reading focus without excluding evidence. A matching receipt avoids repeating unchanged source.",
      inputSchema: prepareInputSchema as z.ZodTypeAny,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (input, extra) => {
      try {
        const result = await preparer.prepare(root, input, extra.signal);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return failure(error);
      }
    },
  );
  server.registerTool(
    "jev_context",
    {
      description: "Select relevant evidence from explicitly supplied files under the pinned root.",
      inputSchema: contextInputSchema as z.ZodTypeAny,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (input, extra) => {
      try {
        return json(await collectContext(client, root, input as ContextInput, extra.signal));
      } catch (error) {
        return failure(error);
      }
    },
  );
  server.registerTool(
    "jev_evaluate",
    {
      description:
        "Evaluate explicit typed questions against supplied state. Results are advisory.",
      inputSchema: evaluationInputSchema as z.ZodTypeAny,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (input, extra) => {
      try {
        return json(await client.evaluate(input, extra.signal));
      } catch (error) {
        return failure(error);
      }
    },
  );
  server.registerTool(
    "jev_status",
    {
      description: "Report non-secret local adapter configuration and limits.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () =>
      json({
        ...client.status(),
        root: "pinned",
        contextLimits: { maxFiles: 128, maxChunks: 24, maxChunkBytes: 8192 },
      }),
  );
  return server;
}

export async function serve(root: string): Promise<void> {
  const canonicalRoot = await realpath(resolve(root));
  if (!(await stat(canonicalRoot)).isDirectory()) throw new Error("root must be a directory");
  const client = new JevClient();
  const server = createServer(client, canonicalRoot);
  await server.connect(new StdioServerTransport());
}

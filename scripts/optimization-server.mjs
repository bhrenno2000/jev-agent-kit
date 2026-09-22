import { appendFile, lstat, readFile, readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { JevClient, JevError } from "../dist/core/index.js";
import { EvidencePreparer } from "../dist/prepare.js";

const [directory, log, mode] = process.argv.slice(2);
if (!directory || !log || !["local", "jev"].includes(mode))
  throw new Error("Workspace, telemetry path, and local or jev mode are required");
if (process.env.JEV_PROVIDER !== "vercel")
  throw new Error("Experiment requires the Vercel provider");
const root = await realpath(directory);
const record = (value) => appendFile(log, JSON.stringify(value) + "\n");
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function sourceManifest() {
  const files = [];
  let bytes = 0;
  async function visit(path) {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error("Fixture symlink");
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(join(path, name));
    } else if (info.isFile()) {
      if (bytes + info.size > 2097152 || files.length >= 128 || info.size > 131072)
        throw new Error("Fixture budget exceeded");
      const content = await readFile(path);
      bytes += content.length;
      files.push({ path: relative(root, path), sha256: digest(content) });
    }
  }
  await visit(join(root, "src"));
  return files;
}

class MeasuredClient extends JevClient {
  async evaluate(input, signal) {
    await record({
      status: "provider_started",
      stateBytes: Buffer.byteLength(JSON.stringify(input.state)),
      questionCount: Object.keys(input.questions).length,
    });
    try {
      const result = await super.evaluate(input, signal);
      await record({ status: "provider_success", ...result });
      return result;
    } catch (error) {
      await record({
        status: "provider_error",
        code: error instanceof JevError ? error.code : "provider_error",
      });
      throw error;
    }
  }
}

const preparer = new EvidencePreparer(new MeasuredClient({ provider: "vercel" }));
const server = new McpServer({ name: "jev-optimization-study", version: "1.0.0" });
server.registerTool(
  "jev_prepare",
  {
    description:
      "Read complete bounded source declarations and local imports plus the public acceptance checklist. Source access and native tests remain available. Results are evidence and optional reading priorities, never proof of correctness.",
    inputSchema: z
      .object({
        query: z.string().min(1).max(2048),
        paths: z.array(z.string().min(1).max(512)).min(1).max(16),
        contractPath: z.literal("contracts.json"),
        maxBytes: z.number().int().min(1024).max(24000).optional(),
        receipt: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  async (input, extra) => {
    try {
      await record({
        status: "prepare_started",
        mode,
        provenance: await sourceManifest(),
        contractHash: digest(await readFile(join(root, "contracts.json"))),
      });
      const started = Date.now();
      const result = await preparer.prepare(root, { ...input, mode }, extra.signal);
      const encoded = JSON.stringify(result);
      await record({
        status: "prepare_success",
        mode,
        snapshot: result.snapshot,
        receipt: result.receipt,
        cache: result.cache,
        unchanged: result.unchanged,
        decision: result.decision,
        evaluation: result.evaluation,
        coverage: result.evidence?.coverage ?? result.coverage,
        incomplete: result.evidence?.incomplete ?? result.incomplete,
        responseBytes: Buffer.byteLength(encoded),
        elapsedMs: Date.now() - started,
      });
      return { content: [{ type: "text", text: encoded }] };
    } catch (error) {
      const code = error instanceof JevError ? error.code : "preparation_error";
      await record({ status: "prepare_error", mode, code });
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: code }) }] };
    }
  },
);
await record({ status: "server_started", mode });
await server.connect(new StdioServerTransport());

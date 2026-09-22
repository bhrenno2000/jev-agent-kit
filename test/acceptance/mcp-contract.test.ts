import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { after, describe, it } from "node:test";

const children: StdioClientTransport[] = [];
const root = resolve("fixtures/context-repository");

async function connect(
  mode = "normal",
  capture?: string,
  workspace = root,
): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", resolve("test/acceptance/mcp-process.ts")],
    env: {
      ...process.env,
      JEV_TEST_ROOT: workspace,
      JEV_STANDIN_MODE: mode,
      ...(capture ? { JEV_CAPTURE: capture } : {}),
    },
  });
  const client = new Client({ name: "jev-acceptance", version: "0.1.0" });
  children.push(transport);
  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close();
    throw error;
  }
  return { client, transport };
}

after(async () => {
  for (const transport of children) await transport.close();
});

describe("MCP acceptance contract", () => {
  it("lists the contracted tools deterministically", async () => {
    const { client, transport } = await connect();
    try {
      const first = await client.listTools();
      const second = await client.listTools();
      assert.deepEqual(first.tools, second.tools);
      assert.deepEqual(
        first.tools.map((tool) => tool.name),
        ["jev_context", "jev_evaluate", "jev_status"],
      );
    } finally {
      await transport.close();
    }
  });

  it("sends the exact bounded evaluation body and preserves advisory output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-capture-"));
    const capture = join(directory, "requests.jsonl");
    const { client, transport } = await connect("normal", capture);
    try {
      const state = "The endpoint validates the bearer token before account access.";
      const questions = {
        authenticated: {
          type: "noul",
          instructions: "Is authentication validated before account access?",
          criteria: { true: "yes", false: "no" },
        },
      };
      const result = await client.callTool({
        name: "jev_evaluate",
        arguments: { state, questions },
      });
      assert.equal(result.isError, undefined);
      assert.match(JSON.stringify(result), /advisory/);
      const request = JSON.parse((await readFile(capture, "utf8")).trim()) as {
        headers: Record<string, string>;
        body: Record<string, unknown>;
      };
      assert.deepEqual(request.body, { state, model: "jev-1.13.0", questions });
      assert.ok(request.headers.authorization);
      assert.match(request.headers.authorization, /^Bearer ts_test_secret$/);
    } finally {
      await transport.close();
    }
  });

  it("reports provider failures without echoing state, response, or credentials", async () => {
    const { client, transport } = await connect("http-error");
    try {
      const result = await client.callTool({
        name: "jev_evaluate",
        arguments: {
          state: "private state ts_test_secret",
          questions: { x: { type: "noul", instructions: "Is this true?" } },
        },
      });
      assert.equal(result.isError, true);
      assert.doesNotMatch(JSON.stringify(result), /ts_test_secret|private state|provider failure/);
    } finally {
      await transport.close();
    }
  });

  it("rejects malformed provider output and path escape attempts", async () => {
    const malformed = await connect("malformed");
    try {
      const result = await malformed.client.callTool({
        name: "jev_evaluate",
        arguments: {
          state: "x",
          questions: { x: { type: "noul", instructions: "Is this true?" } },
        },
      });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result), /invalid_response/);
    } finally {
      await malformed.transport.close();
    }
    const normal = await connect();
    try {
      const result = await normal.client.callTool({
        name: "jev_context",
        arguments: { query: "auth", paths: ["../outside.ts", "/etc/passwd", "src/auth.ts"] },
      });
      assert.equal(result.isError, undefined);
      assert.match(JSON.stringify(result), /skipped/);
      assert.match(JSON.stringify(result), /outside root|must be relative/);
    } finally {
      await normal.transport.close();
    }
  });

  it("marks symlinked files as skipped and reports incomplete coverage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-links-"));
    const workspace = join(directory, "root");
    await mkdir(workspace);
    await writeFile(join(directory, "outside.ts"), "export const outside = true;");
    await symlink(join(directory, "outside.ts"), join(workspace, "linked.ts"));
    let transport: StdioClientTransport | undefined;
    try {
      const connected = await connect("normal", undefined, workspace);
      const client = connected.client;
      transport = connected.transport;
      const result = await client.callTool({
        name: "jev_context",
        arguments: { query: "safe", paths: ["safe.ts", "linked.ts", "missing.ts"], maxFiles: 2 },
      });
      assert.equal(result.isError, undefined);
      const parsed = JSON.parse(JSON.stringify(result)) as {
        structuredContent?: {
          incomplete?: boolean;
          files?: Array<{ path: string; status: string; reason?: string }>;
        };
      };
      const files = parsed.structuredContent?.files ?? [];
      assert.equal(parsed.structuredContent?.incomplete, true);
      assert.equal(files.find((item) => item.path === "linked.ts")?.status, "skipped");
      assert.equal(files.find((item) => item.path === "missing.ts")?.status, "skipped");
      assert.match(
        files.find((item) => item.path === "linked.ts")?.reason ?? "",
        /symlink|symbolic|regular|sensitive/,
      );
    } finally {
      await transport?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("enforces context request budgets and preserves source integrity metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-budget-"));
    const capture = join(directory, "requests.jsonl");
    const { client, transport } = await connect("normal", capture);
    try {
      const result = await client.callTool({
        name: "jev_context",
        arguments: {
          query: "authentication",
          paths: ["src/auth.ts", "src/billing.ts"],
          maxChunks: 1,
          chunkBytes: 512,
        },
      });
      assert.equal(result.isError, undefined);
      const parsed = JSON.parse(JSON.stringify(result)) as {
        structuredContent?: {
          evaluations?: { calls?: number };
          selected?: Array<{ path: string; digest: string; startLine: number; endLine: number }>;
        };
      };
      assert.equal(parsed.structuredContent?.evaluations?.calls, 1);
      for (const item of parsed.structuredContent?.selected ?? []) {
        assert.match(item.path, /^src\//);
        assert.match(item.digest, /^[a-f0-9]{64}$/);
        assert.ok(item.startLine >= 1);
        assert.ok(item.endLine >= item.startLine);
      }
      const calls = (await readFile(capture, "utf8")).trim().split("\n").filter(Boolean);
      assert.equal(calls.length, 1);
    } finally {
      await transport.close();
    }
  });
});

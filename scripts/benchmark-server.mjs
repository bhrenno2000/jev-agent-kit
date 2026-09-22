import { appendFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JevClient, JevError } from "../dist/core/index.js";
import { createServer } from "../dist/server.js";

const [root, log] = process.argv.slice(2);
if (!root || !log) throw new Error("Benchmark root and telemetry path are required");
class MeasuredClient extends JevClient {
  async evaluate(input, signal) {
    await appendFile(log, JSON.stringify({ status: "request_started" }) + "\n");
    try {
      const result = await super.evaluate(input, signal);
      await appendFile(
        log,
        JSON.stringify({
          status: "success",
          model: result.model,
          usage: result.usage,
          providerMetadata: result.providerMetadata ?? null,
          meta: result.meta,
        }) + "\n",
      );
      return result;
    } catch (error) {
      await appendFile(
        log,
        JSON.stringify({
          status: "error",
          code: error instanceof JevError ? error.code : "unknown_error",
        }) + "\n",
      );
      throw error;
    }
  }
}
await appendFile(log, JSON.stringify({ status: "server_started" }) + "\n");
const server = createServer(new MeasuredClient(), root);
await server.connect(new StdioServerTransport());

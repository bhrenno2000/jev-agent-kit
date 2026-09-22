import { createServer as createHttpServer } from "node:http";
import { appendFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JevClient } from "../../src/core/index.js";
import { createServer } from "../../src/server.js";

const mode = process.env.JEV_STANDIN_MODE ?? "normal";
const capture = process.env.JEV_CAPTURE;
const api = createHttpServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", async () => {
    if (capture)
      await appendFile(
        capture,
        `${JSON.stringify({ headers: request.headers, body: JSON.parse(body) })}\n`,
      );
    if (mode === "malformed") {
      response.writeHead(200, { "content-type": "application/json" }).end('{"answers":');
      return;
    }
    if (mode === "http-error") {
      response.writeHead(503).end("provider failure with secret ts_test_secret");
      return;
    }
    if (mode === "delay") {
      setTimeout(
        () =>
          response
            .writeHead(200, { "content-type": "application/json" })
            .end(
              JSON.stringify({
                model: "jev-1.13.0",
                answers: {},
                usage: { input_tokens: 1, output_tokens: 0 },
              }),
            ),
        5000,
      );
      return;
    }
    const input = JSON.parse(body) as {
      state: unknown;
      questions: Record<string, { type: string; criteria?: Record<string, string> }>;
    };
    const state = JSON.stringify(input.state);
    const answers = Object.fromEntries(
      Object.entries(input.questions).map(([id, question]) => {
        if (question.type === "choice") {
          const keys = Object.keys(question.criteria ?? {});
          const choice = state.includes("duplicate")
            ? "billing"
            : state.includes("sign in")
              ? "account"
              : keys[0];
          return [
            id,
            {
              type: "choice",
              choice,
              probabilities: Object.fromEntries(
                keys.map((key) => [
                  key,
                  key === choice ? 0.95 : 0.05 / Math.max(keys.length - 1, 1),
                ]),
              ),
              confidence: 0.95,
            },
          ];
        }
        if (question.type === "score")
          return [
            id,
            {
              type: "score",
              score: 1,
              probabilities: { "0": 0.1, "1": 0.8, "2": 0.1 },
              confidence: 0.8,
            },
          ];
        return [
          id,
          {
            type: "noul",
            noul: state.includes("validates") || state.includes("urgent") ? 0.95 : 0.05,
          },
        ];
      }),
    );
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(
        JSON.stringify({
          model: "jev-1.13.0",
          answers,
          usage: { input_tokens: Buffer.byteLength(body), output_tokens: 0 },
        }),
      );
  });
});

api.listen(0, "127.0.0.1", async () => {
  const address = api.address();
  if (!address || typeof address === "string") throw new Error("stand-in did not bind");
  const client = new JevClient({
    apiKey: "ts_test_secret",
    endpoint: `http://127.0.0.1:${address.port}/v1/systemone`,
    timeoutMs: 300,
    fetch,
  });
  const server = await createServer(client, process.env.JEV_TEST_ROOT ?? process.cwd());
  const transport = new StdioServerTransport();
  const close = () => {
    api.close();
    process.exit(0);
  };
  process.stdin.once("end", close);
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  await server.connect(transport);
});

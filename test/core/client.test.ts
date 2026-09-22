import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JevClient, JevError, evaluationInputSchema } from "../../src/core/index.js";

const input = {
  state: "A small bug report",
  questions: {
    severity: {
      type: "score" as const,
      instructions: "How severe is this?",
      criteria: ["Low", "High"],
    },
    route: {
      type: "choice" as const,
      instructions: "Which route?",
      criteria: { bug: "A bug", question: "A question" },
    },
    urgent: { type: "noul" as const, instructions: "Is this urgent?" },
  },
};

const body = {
  model: "jev-1.13.0",
  answers: {
    severity: {
      type: "score",
      score: 0.75,
      probabilities: { "0": 0.25, "1": 0.75 },
      confidence: 0.5,
      legend: { "0": "Low", "1": "High" },
    },
    route: {
      type: "choice",
      choice: "bug",
      probabilities: { bug: 0.8, question: 0.2 },
      confidence: 0.6,
    },
    urgent: { type: "noul", noul: 0.9 },
  },
  usage: { input_tokens: 12, output_tokens: 4 },
};

function response(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("evaluation schema enforces bounded atomic questions", () => {
  assert.throws(() => evaluationInputSchema.parse({ state: "x", questions: {} }));
  assert.throws(() =>
    evaluationInputSchema.parse({
      state: "x",
      questions: { x: { type: "score", instructions: "x", criteria: ["one"] } },
    }),
  );
});

test("client preserves score distributions and metadata", async () => {
  const client = new JevClient({
    apiKey: "secret",
    endpoint: "http://127.0.0.1:4321/v1/systemone",
    fetch: async () => response(body),
  });
  const result = await client.evaluate(input);
  const severity = result.answers.severity;
  assert.ok(severity);
  assert.equal(severity.type, "score");
  assert.equal((severity as { score: number }).score, 0.75);
  assert.equal(result.meta.advisory, true);
  assert.equal(result.meta.attempts, 1);
});

test("client retries one transient response", async () => {
  let calls = 0;
  const client = new JevClient({
    apiKey: "secret",
    endpoint: "http://127.0.0.1:4321/v1/systemone",
    fetch: async () => {
      calls += 1;
      return calls === 1 ? response({}, 503, { "retry-after": "0" }) : response(body);
    },
  });
  const result = await client.evaluate(input);
  assert.equal(result.model, "jev-1.13.0");
  assert.equal(result.meta.attempts, 2);
});

test("client refuses invalid provider distributions without leaking data", async () => {
  const client = new JevClient({
    apiKey: "super-secret",
    endpoint: "http://127.0.0.1:4321/v1/systemone",
    fetch: async () =>
      response({
        ...body,
        answers: {
          ...body.answers,
          route: { ...body.answers.route, probabilities: { bug: 4, question: 0 } },
        },
      }),
  });
  await assert.rejects(
    client.evaluate(input),
    (error: unknown) =>
      error instanceof JevError &&
      error.code === "invalid_response" &&
      !error.message.includes("super-secret"),
  );
});

test("client status excludes credentials", () => {
  const client = new JevClient({
    apiKey: "super-secret",
    endpoint: "http://127.0.0.1:4321/v1/systemone",
  });
  assert.equal(JSON.stringify(client.status()).includes("super-secret"), false);
});

test("client rejects unsafe endpoint forms and invalid timeout configuration", () => {
  assert.throws(
    () => new JevClient({ endpoint: "https://user:pass@api.typesafe.ai/v1/systemone" }),
    (error: unknown) => error instanceof JevError && error.code === "invalid_endpoint",
  );
  assert.throws(
    () => new JevClient({ endpoint: "https://api.typesafe.ai/v1/systemone?x=1" }),
    (error: unknown) => error instanceof JevError && error.code === "invalid_endpoint",
  );
  const previous = process.env.JEV_TIMEOUT_MS;
  process.env.JEV_TIMEOUT_MS = "not-a-number";
  try {
    assert.throws(
      () => new JevClient(),
      (error: unknown) => error instanceof JevError && error.code === "invalid_timeout",
    );
  } finally {
    if (previous === undefined) delete process.env.JEV_TIMEOUT_MS;
    else process.env.JEV_TIMEOUT_MS = previous;
  }
});

test("client rejects pre-aborted calls without invoking fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const client = new JevClient({
    apiKey: "secret",
    endpoint: "http://127.0.0.1:4321/v1/systemone",
    fetch: async () => {
      calls += 1;
      return response(body);
    },
  });
  await assert.rejects(
    client.evaluate(input, controller.signal),
    (error: unknown) => error instanceof JevError && error.code === "aborted",
  );
  assert.equal(calls, 0);
});

test("client caps streaming response bodies", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(65536));
    },
    cancel() {
      cancelled = true;
    },
  });
  const client = new JevClient({
    apiKey: "secret",
    endpoint: "http://127.0.0.1:4321/v1/systemone",
    fetch: async () => new Response(stream),
  });
  await assert.rejects(
    client.evaluate(input),
    (error: unknown) => error instanceof JevError && error.code === "response_too_large",
  );
  assert.equal(cancelled, true);
});

test("client aborts a hanging response body at the total deadline", async () => {
  const stream = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => undefined);
    },
  });
  const client = new JevClient({
    apiKey: "secret",
    timeoutMs: 100,
    endpoint: "http://127.0.0.1:4321/v1/systemone",
    fetch: async () => new Response(stream),
  });
  await assert.rejects(
    client.evaluate(input),
    (error: unknown) => error instanceof JevError && error.code === "timeout",
  );
});

test("client does not retry beyond the bounded retry-after allowance", async () => {
  let calls = 0;
  const client = new JevClient({
    apiKey: "secret",
    endpoint: "http://127.0.0.1:4321/v1/systemone",
    fetch: async () => {
      calls += 1;
      return response({}, 503, { "retry-after": "10" });
    },
  });
  await assert.rejects(
    client.evaluate(input),
    (error: unknown) => error instanceof JevError && error.code === "retry_unavailable",
  );
  assert.equal(calls, 1);
});

test("client rejects oversized serialized request before network access", async () => {
  const questions: Record<string, unknown> = {};
  for (let index = 0; index < 24; index += 1)
    questions[`q${index}`] = { type: "noul", instructions: "x".repeat(2048) };
  let calls = 0;
  const client = new JevClient({
    apiKey: "secret",
    endpoint: "http://127.0.0.1:4321/v1/systemone",
    fetch: async () => {
      calls += 1;
      return response(body);
    },
  });
  await assert.rejects(
    client.evaluate({ state: "x", questions }),
    (error: unknown) => error instanceof JevError && error.code === "request_too_large",
  );
  assert.equal(calls, 0);
});

test("client rejects cyclic and deeply nested input before schema parsing", async () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const client = new JevClient({
    apiKey: "secret",
    endpoint: "http://127.0.0.1:4321/v1/systemone",
  });
  await assert.rejects(
    client.evaluate({ state: cyclic, questions: input.questions }),
    (error: unknown) => error instanceof JevError && error.code === "invalid_input",
  );
  let deep: unknown = "x";
  for (let index = 0; index < 40; index += 1) deep = [deep];
  await assert.rejects(
    client.evaluate({ state: deep, questions: input.questions }),
    (error: unknown) => error instanceof JevError && error.code === "invalid_input",
  );
});

test("client rejects missing answer IDs, wrong types, nonfinite values, and negative usage", async () => {
  const client = new JevClient({
    apiKey: "secret",
    endpoint: "http://127.0.0.1:4321/v1/systemone",
    fetch: async () => response({ ...body, usage: { input_tokens: -1, output_tokens: 0 } }),
  });
  await assert.rejects(
    client.evaluate(input),
    (error: unknown) => error instanceof JevError && error.code === "invalid_response",
  );
  const wrong = new JevClient({
    apiKey: "secret",
    endpoint: "http://127.0.0.1:4321/v1/systemone",
    fetch: async () =>
      response({
        ...body,
        answers: { ...body.answers, route: { ...body.answers.route, type: "noul" } },
      }),
  });
  await assert.rejects(
    wrong.evaluate(input),
    (error: unknown) => error instanceof JevError && error.code === "invalid_response",
  );
  const missing = new JevClient({
    apiKey: "secret",
    endpoint: "http://127.0.0.1:4321/v1/systemone",
    fetch: async () =>
      response({
        ...body,
        answers: { severity: body.answers.severity, route: body.answers.route },
      }),
  });
  await assert.rejects(
    missing.evaluate(input),
    (error: unknown) => error instanceof JevError && error.code === "invalid_response",
  );
});

test("client bounds credential files and accepts one trailing newline", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-core-"));
  const keyPath = join(root, "key");
  await writeFile(keyPath, "secret\n", "utf8");
  const client = new JevClient({
    endpoint: "http://127.0.0.1:4321/v1/systemone",
    fetch: async (_url, request) => {
      assert.equal((request?.headers as Record<string, string>).authorization, "Bearer secret");
      return response(body);
    },
  });
  const previous = process.env.TYPESAFE_API_KEY_FILE;
  const direct = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY_FILE = keyPath;
  try {
    await client.evaluate(input);
  } finally {
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY_FILE;
    else process.env.TYPESAFE_API_KEY_FILE = previous;
    if (direct === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = direct;
  }
  await writeFile(keyPath, "x".repeat(4097), "utf8");
  const oversized = new JevClient({ endpoint: "http://127.0.0.1:4321/v1/systemone" });
  const oldFile = process.env.TYPESAFE_API_KEY_FILE;
  process.env.TYPESAFE_API_KEY_FILE = keyPath;
  try {
    await assert.rejects(
      oversized.evaluate(input),
      (error: unknown) => error instanceof JevError && error.code === "missing_api_key",
    );
  } finally {
    if (oldFile === undefined) delete process.env.TYPESAFE_API_KEY_FILE;
    else process.env.TYPESAFE_API_KEY_FILE = oldFile;
  }
});

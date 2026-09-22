import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JevClient, JevError } from "../../src/core/index.js";

const input = {
  state: "evidence",
  questions: { relevant: { type: "noul" as const, instructions: "Is this relevant?" } },
};

const result = {
  model: "typesafe-ai/jev",
  answers: { relevant: { type: "noul", noul: 0.9 } },
  usage: { input_tokens: 1, output_tokens: 1 },
};

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("provider defaults select TypeSafe endpoint and model", async () => {
  const oldProvider = process.env.JEV_PROVIDER;
  const oldModel = process.env.JEV_MODEL;
  delete process.env.JEV_PROVIDER;
  delete process.env.JEV_MODEL;
  try {
    let url = "";
    let model = "";
    const client = new JevClient({
      provider: "typesafe",
      apiKey: "typesafe-secret",
      fetch: async (request, init) => {
        url = String(request);
        model = JSON.parse(String(init?.body)).model;
        return new Response(JSON.stringify(result), { status: 200 });
      },
    });
    await client.evaluate(input);
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(model, "jev-1.13.0");
    assert.equal(client.status().provider, "typesafe");
  } finally {
    restore("JEV_PROVIDER", oldProvider);
    restore("JEV_MODEL", oldModel);
  }
});

test("Vercel selects its fixed endpoint and namespaced model", async () => {
  const oldModel = process.env.JEV_MODEL;
  delete process.env.JEV_MODEL;
  try {
    let url = "";
    const client = new JevClient({
      provider: "vercel",
      apiKey: "vercel-secret",
      fetch: async (request) => {
        url = String(request);
        return new Response(JSON.stringify(result), { status: 200 });
      },
    });
    await client.evaluate(input);
    assert.equal(url, "https://ai-gateway.vercel.sh/typesafe/v1/systemone");
    assert.equal(client.status().model, "typesafe-ai/jev");
  } finally {
    restore("JEV_MODEL", oldModel);
  }
});

test("Vercel ignores TypeSafe credentials and does not fetch without its key", async () => {
  const oldTypesafe = process.env.TYPESAFE_API_KEY;
  const oldTypesafeFile = process.env.TYPESAFE_API_KEY_FILE;
  const oldVercel = process.env.AI_GATEWAY_API_KEY;
  const oldVercelFile = process.env.AI_GATEWAY_API_KEY_FILE;
  process.env.TYPESAFE_API_KEY = "wrong-provider-secret";
  delete process.env.TYPESAFE_API_KEY_FILE;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY_FILE;
  let calls = 0;
  try {
    const client = new JevClient({
      provider: "vercel",
      fetch: async () => {
        calls += 1;
        return new Response(JSON.stringify(result), { status: 200 });
      },
    });
    assert.equal(client.status().credentialSource, "none");
    await assert.rejects(
      client.evaluate(input),
      (error: unknown) =>
        error instanceof JevError &&
        error.code === "missing_api_key" &&
        error.message === "Provider API key is not configured",
    );
    assert.equal(calls, 0);
  } finally {
    restore("TYPESAFE_API_KEY", oldTypesafe);
    restore("TYPESAFE_API_KEY_FILE", oldTypesafeFile);
    restore("AI_GATEWAY_API_KEY", oldVercel);
    restore("AI_GATEWAY_API_KEY_FILE", oldVercelFile);
  }
});

test("TypeSafe ignores Vercel credentials and does not fetch without its key", async () => {
  const oldTypesafe = process.env.TYPESAFE_API_KEY;
  const oldTypesafeFile = process.env.TYPESAFE_API_KEY_FILE;
  const oldVercel = process.env.AI_GATEWAY_API_KEY;
  const oldVercelFile = process.env.AI_GATEWAY_API_KEY_FILE;
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY_FILE;
  process.env.AI_GATEWAY_API_KEY = "wrong-provider-secret";
  delete process.env.AI_GATEWAY_API_KEY_FILE;
  let calls = 0;
  try {
    const client = new JevClient({
      provider: "typesafe",
      fetch: async () => {
        calls += 1;
        return new Response(JSON.stringify(result), { status: 200 });
      },
    });
    assert.equal(client.status().credentialSource, "none");
    await assert.rejects(
      client.evaluate(input),
      (error: unknown) => error instanceof JevError && error.code === "missing_api_key",
    );
    assert.equal(calls, 0);
  } finally {
    restore("TYPESAFE_API_KEY", oldTypesafe);
    restore("TYPESAFE_API_KEY_FILE", oldTypesafeFile);
    restore("AI_GATEWAY_API_KEY", oldVercel);
    restore("AI_GATEWAY_API_KEY_FILE", oldVercelFile);
  }
});

test("matching environment credentials are sent to the selected provider", async () => {
  const oldKey = process.env.AI_GATEWAY_API_KEY;
  const oldOther = process.env.TYPESAFE_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "gateway-secret";
  delete process.env.TYPESAFE_API_KEY;
  try {
    const client = new JevClient({
      provider: "vercel",
      fetch: async (_request, init) => {
        assert.equal(
          (init?.headers as Record<string, string>).authorization,
          "Bearer gateway-secret",
        );
        return new Response(JSON.stringify(result), { status: 200 });
      },
    });
    assert.equal(client.status().credentialSource, "env");
    await client.evaluate(input);
  } finally {
    restore("AI_GATEWAY_API_KEY", oldKey);
    restore("TYPESAFE_API_KEY", oldOther);
  }
});

test("matching credential files are selected by provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-provider-"));
  const keyPath = join(root, "gateway-key");
  await writeFile(keyPath, "file-secret\n", "utf8");
  const oldFile = process.env.AI_GATEWAY_API_KEY_FILE;
  const oldEnv = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY_FILE = keyPath;
  delete process.env.AI_GATEWAY_API_KEY;
  try {
    const client = new JevClient({
      provider: "vercel",
      fetch: async (_request, init) => {
        assert.equal((init?.headers as Record<string, string>).authorization, "Bearer file-secret");
        return new Response(JSON.stringify(result), { status: 200 });
      },
    });
    assert.equal(client.status().credentialSource, "file");
    await client.evaluate(input);
  } finally {
    restore("AI_GATEWAY_API_KEY_FILE", oldFile);
    restore("AI_GATEWAY_API_KEY", oldEnv);
  }
});

test("TypeSafe credential file is selected without Vercel fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-provider-"));
  const keyPath = join(root, "typesafe-key");
  await writeFile(keyPath, "typesafe-file-secret\n", "utf8");
  const oldFile = process.env.TYPESAFE_API_KEY_FILE;
  const oldEnv = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY_FILE = keyPath;
  delete process.env.TYPESAFE_API_KEY;
  try {
    const client = new JevClient({
      provider: "typesafe",
      fetch: async (_request, init) => {
        assert.equal(
          (init?.headers as Record<string, string>).authorization,
          "Bearer typesafe-file-secret",
        );
        return new Response(JSON.stringify(result), { status: 200 });
      },
    });
    assert.equal(client.status().credentialSource, "file");
    await client.evaluate(input);
  } finally {
    restore("TYPESAFE_API_KEY_FILE", oldFile);
    restore("TYPESAFE_API_KEY", oldEnv);
  }
});

test("unknown providers are rejected and status never exposes credential values or paths", () => {
  assert.throws(
    () => new JevClient({ provider: "other" as "typesafe" }),
    (error: unknown) => error instanceof JevError && error.code === "invalid_provider",
  );
  const client = new JevClient({
    provider: "vercel",
    apiKey: "super-secret",
    endpoint: "http://127.0.0.1:4321/decisions",
  });
  const status = JSON.stringify(client.status());
  assert.equal(status.includes("super-secret"), false);
  assert.equal(status.includes("API_KEY"), false);
  assert.equal(client.status().endpoint, "http://127.0.0.1:4321/decisions");
  assert.equal(client.status().credentialSource, "explicit");
});

test("Vercel gateway metadata is bounded and allowlisted", async () => {
  const client = new JevClient({
    provider: "vercel",
    apiKey: "vercel-secret",
    fetch: async () =>
      new Response(
        JSON.stringify({
          ...result,
          provider_metadata: {
            gateway: {
              cost: "0.00001155",
              generationId: "gen_123",
              unexpected: "discarded",
              marketCost: "01.2",
              surchargeCost: "-1",
              gatewayCost: "1e-3",
            },
          },
        }),
        { status: 200 },
      ),
  });
  const evaluated = await client.evaluate(input);
  assert.deepEqual(evaluated.providerMetadata, {
    gateway: { cost: "0.00001155", generationId: "gen_123" },
  });
});

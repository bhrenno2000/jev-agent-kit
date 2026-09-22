import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { JevClient, evaluationInputSchema } from "../src/core/index.js";
import { createServer } from "../src/server.js";

export type Expected = string | boolean | null;
export type EvaluationCase = {
  id: string;
  state: string;
  questions: Record<string, { type: string; [key: string]: unknown }>;
  expected: Record<string, Expected>;
};
export type Fixture = { version: number; cases: EvaluationCase[] };
export type Observation = {
  id: string;
  exitCode: number;
  answers?: Record<string, { expected: Expected; actual: Expected }>;
  [key: string]: unknown;
};
export type Confusion = {
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
  abstained: number;
  total: number;
  precision: number | null;
  recall: number | null;
};

export function confusionMatrix(
  rows: Array<{ expected: boolean; actual: boolean | null }>,
): Confusion {
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let abstained = 0;
  for (const row of rows) {
    if (row.actual === null) abstained += 1;
    else if (row.expected && row.actual) truePositive += 1;
    else if (!row.expected && !row.actual) trueNegative += 1;
    else if (row.actual) falsePositive += 1;
    else falseNegative += 1;
  }
  return {
    truePositive,
    trueNegative,
    falsePositive,
    falseNegative,
    abstained,
    total: rows.length,
    precision: truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : null,
    recall: truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : null,
  };
}

export function overallRecallCountingAbstentionsAsMisses(
  rows: Array<{ expected: boolean; actual: boolean | null }>,
): number | null {
  const positives = rows.filter((row) => row.expected).length;
  if (!positives) return null;
  return rows.filter((row) => row.expected && row.actual === true).length / positives;
}

export function classifyNoul(value: number): boolean | null {
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  if (value <= 0.2) return false;
  if (value >= 0.8) return true;
  return null;
}

function parseArgs(argv: string[]): { fixture: string; live: boolean; contextLive: boolean } {
  let fixture = "fixtures/evaluation.json";
  let live = false;
  let contextLive = false;
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--live") live = true;
    else if (item === "--context-live") {
      live = true;
      contextLive = true;
    } else if (item === "--fixture") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error("--fixture requires a file");
      fixture = value;
    } else if (item && !item.startsWith("-")) fixture = item;
    else throw new Error("Unknown evaluation option");
  }
  return { fixture, live, contextLive };
}

export function aggregateQuality(fixture: Fixture, observations: Observation[]) {
  const noulRows: Array<{ expected: boolean; actual: boolean | null }> = [];
  let expectedAnswers = 0;
  let availableAnswers = 0;
  let decisiveAnswers = 0;
  let correctAnswers = 0;
  let errors = 0;
  for (const item of fixture.cases) {
    const observation = observations.find((row) => row.id === item.id);
    const available = observation?.exitCode === 0;
    if (!available) errors += 1;
    for (const [key, expected] of Object.entries(item.expected)) {
      if (item.questions[key]?.type === "score") continue;
      expectedAnswers += 1;
      const answer = available ? observation?.answers?.[key] : undefined;
      if (answer) availableAnswers += 1;
      const actual = answer?.actual ?? null;
      if (actual !== null) decisiveAnswers += 1;
      if (answer && actual === expected) correctAnswers += 1;
      if (typeof expected === "boolean")
        noulRows.push({ expected, actual: typeof actual === "boolean" ? actual : null });
    }
  }
  const matrix = confusionMatrix(noulRows);
  return {
    errors,
    expectedAnswers,
    availableAnswers,
    decisiveAnswers,
    correctAnswers,
    exactMatchRate: expectedAnswers ? correctAnswers / expectedAnswers : null,
    availability: expectedAnswers ? availableAnswers / expectedAnswers : null,
    coverage: expectedAnswers ? decisiveAnswers / expectedAnswers : null,
    selectiveNoul: {
      ...matrix,
      coverage: matrix.total ? (matrix.total - matrix.abstained) / matrix.total : null,
    },
    overallNoulRecallCountingAbstentionsAsMisses:
      overallRecallCountingAbstentionsAsMisses(noulRows),
  };
}

async function describeTools(): Promise<string> {
  const server = createServer(
    new JevClient({ model: "jev-1.13.0", timeoutMs: 30000 }),
    resolve("fixtures/context-repository"),
  );
  const client = new Client({ name: "jev-accounting", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return JSON.stringify({
      ...(await client.listTools()),
      instructions: client.getInstructions(),
    });
  } finally {
    await client.close();
    await server.close();
  }
}

function validateFixture(fixture: Fixture): void {
  if (fixture.version !== 1 || fixture.cases.length < 8)
    throw new Error("fixture must be version 1 with at least eight authored cases");
  const ids = new Set<string>();
  for (const item of fixture.cases) {
    if (ids.has(item.id)) throw new Error(`duplicate fixture case ${item.id}`);
    ids.add(item.id);
    if (!item.id || !item.state || !Object.keys(item.questions).length)
      throw new Error(`invalid fixture case ${item.id}`);
    for (const key of Object.keys(item.expected))
      if (!(key in item.questions))
        throw new Error(`expected answer ${key} is not declared in ${item.id}`);
    evaluationInputSchema.parse({ state: item.state, questions: item.questions });
    if (Object.keys(item.expected).length !== Object.keys(item.questions).length)
      throw new Error(`expected answers do not exactly match questions in ${item.id}`);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const fixture = JSON.parse(await readFile(resolve(args.fixture), "utf8")) as Fixture;
  validateFixture(fixture);
  const tokenizer = await import("js-tiktoken").then((module) => module.getEncoding("cl100k_base"));
  const accounting = fixture.cases.map((item) => {
    const request = JSON.stringify({ state: item.state, questions: item.questions });
    const toolEnvelope = JSON.stringify({
      method: "tools/call",
      params: { name: "jev_evaluate", arguments: JSON.parse(request) },
    });
    return {
      id: item.id,
      requestBytes: Buffer.byteLength(request),
      requestTokensProxy: tokenizer.encode(request).length,
      toolEnvelopeBytes: Buffer.byteLength(toolEnvelope),
      toolEnvelopeTokensProxy: tokenizer.encode(toolEnvelope).length,
    };
  });
  const toolDefinitions = await describeTools();
  const baseReport = {
    mode: args.live ? "live" : "offline",
    fixture: resolve(args.fixture),
    cases: fixture.cases.length,
    accounting: {
      tokenizer: "cl100k_base proxy",
      rows: accounting,
      toolDefinitionsBytes: Buffer.byteLength(toolDefinitions),
      toolDefinitionsTokensProxy: tokenizer.encode(toolDefinitions).length,
    },
    quality: {
      status: "not_run" as const,
      reason: args.live
        ? undefined
        : "offline mode validates fixtures and accounting only; no inference was run",
    },
  };
  if (!args.live) {
    process.stdout.write(`${JSON.stringify(baseReport, null, 2)}\n`);
    return;
  }
  if (!process.env.TYPESAFE_API_KEY && !process.env.TYPESAFE_API_KEY_FILE)
    throw new Error("live mode requires TYPESAFE_API_KEY or TYPESAFE_API_KEY_FILE");
  const observations: Observation[] = [];
  const binary = resolve("dist/cli.js");
  for (const item of fixture.cases) {
    const started = performance.now();
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>(
      (done, reject) => {
        const child = spawn(process.execPath, [binary, "evaluate", "--input", "-"], {
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.once("error", reject);
        child.once("close", (code) => done({ code: code ?? 1, stdout, stderr }));
        child.stdin.end(JSON.stringify({ state: item.state, questions: item.questions }));
      },
    );
    const row: Observation = {
      id: item.id,
      latencyMs: Math.round(performance.now() - started),
      exitCode: result.code,
      error: result.code ? result.stderr.slice(0, 240) : undefined,
    };
    if (result.code === 0) {
      const parsed = JSON.parse(result.stdout) as {
        model?: string;
        answers: Record<
          string,
          { type: string; noul?: number; choice?: string; confidence?: number }
        >;
        usage?: unknown;
      };
      row.model = parsed.model;
      const responseEnvelope = JSON.stringify({
        content: [{ type: "text", text: result.stdout.trim() }],
        structuredContent: parsed,
      });
      row.responseEnvelopeBytes = Buffer.byteLength(responseEnvelope);
      row.responseEnvelopeTokensProxy = tokenizer.encode(responseEnvelope).length;
      row.usage = parsed.usage;
      row.answers = Object.fromEntries(
        Object.entries(item.expected).map(([key, expected]) => {
          const answer = parsed.answers[key];
          const actual =
            answer?.type === "noul" && typeof answer.noul === "number"
              ? classifyNoul(answer.noul)
              : answer?.type === "choice" && answer.choice === "unknown"
                ? null
                : answer?.type === "choice" &&
                    typeof answer.choice === "string" &&
                    typeof answer.confidence === "number" &&
                    answer.confidence >= 0.8
                  ? answer.choice
                  : null;
          return [key, { expected, actual, confidence: answer?.confidence }];
        }),
      );
    }
    observations.push(row);
  }
  const quality = aggregateQuality(fixture, observations);
  const usageTotals = observations.reduce(
    (total, row) => {
      const usage = row.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      return {
        input_tokens: total.input_tokens + (usage?.input_tokens ?? 0),
        output_tokens: total.output_tokens + (usage?.output_tokens ?? 0),
      };
    },
    { input_tokens: 0, output_tokens: 0 },
  );
  const measured = {
    status: "measured" as const,
    observations,
    ...quality,
    providerUsage: {
      successfulResponsesOnly: true,
      totals: usageTotals,
      rows: observations.map((item) => ({
        id: item.id,
        usage: item.usage,
        model: item.model ?? null,
      })),
    },
  };
  let contextFailed = false;
  if (args.contextLive) {
    const started = performance.now();
    const contextResult = await new Promise<{ code: number; stdout: string; stderr: string }>(
      (done, reject) => {
        const child = spawn(
          process.execPath,
          [binary, "context", "--root", resolve("fixtures/context-repository"), "--input", "-"],
          { env: process.env, stdio: ["pipe", "pipe", "pipe"] },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.once("error", reject);
        child.once("close", (code) => done({ code: code ?? 1, stdout, stderr }));
        child.stdin.end(
          JSON.stringify({
            query: "authentication",
            paths: ["src/auth.ts", "src/billing.ts", "src/health.ts"],
            maxFiles: 3,
            maxChunks: 16,
            chunkBytes: 1024,
          }),
        );
      },
    );
    const context =
      contextResult.code === 0
        ? (JSON.parse(contextResult.stdout) as {
            selected?: Array<{ path: string }>;
            evaluations?: unknown;
            files?: unknown;
          })
        : undefined;
    contextFailed = contextResult.code !== 0;
    const selected = context?.selected ?? [];
    const relevant = selected.filter((item) => item.path === "src/auth.ts").length;
    const irrelevant = selected.filter((item) => item.path !== "src/auth.ts").length;
    const selectedFiles = [...new Set(selected.map((item) => item.path))];
    const candidatePaths = ["src/auth.ts", "src/billing.ts", "src/health.ts"];
    const baselineBytes = (
      await Promise.all(
        candidatePaths.map((path) =>
          readFile(resolve("fixtures/context-repository", path), "utf8"),
        ),
      )
    ).reduce((total, content) => total + Buffer.byteLength(content), 0);
    (measured as Record<string, unknown>).context = {
      latencyMs: Math.round(performance.now() - started),
      exitCode: contextResult.code,
      error: contextResult.code ? contextResult.stderr.slice(0, 240) : undefined,
      selectedFiles,
      sourcePrecision:
        contextResult.code === 0 && selectedFiles.length
          ? (selectedFiles.includes("src/auth.ts") ? 1 : 0) / selectedFiles.length
          : null,
      sourceRecall:
        contextResult.code === 0 ? (selectedFiles.includes("src/auth.ts") ? 1 : 0) : null,
      expectedFiles: ["src/auth.ts"],
      returned: selectedFiles.length,
      providerAndCoverage: context?.evaluations ?? null,
      outputBytes: Buffer.byteLength(contextResult.stdout),
      readBaselineBytes: baselineBytes,
    };
  }
  process.stdout.write(`${JSON.stringify({ ...baseReport, quality: measured }, null, 2)}\n`);
  if (contextFailed || quality.errors) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ error: error instanceof Error ? error.message : "unknown error" })}\n`,
    );
    process.exitCode = 1;
  });

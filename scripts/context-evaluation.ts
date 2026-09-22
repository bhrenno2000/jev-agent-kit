import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";
import { contextInputSchema } from "../src/context.js";
import { z } from "zod";

const rangeSchema = z
  .object({
    path: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine((range) => range.endLine >= range.startLine);

const responseSchema = z.object({
  selected: z.array(rangeSchema),
  recoveryRefs: z.array(rangeSchema),
  evaluations: z.object({
    models: z.array(z.string()),
    calls: z.number().int().nonnegative(),
    usage: z.object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    }),
  }),
  coverage: z.record(z.string(), z.unknown()),
});

export type EvidenceRange = {
  path: string;
  startLine: number;
  endLine: number;
};

export type ContextFixtureCase = {
  id: string;
  query: string;
  paths: string[];
  maxFiles?: number;
  maxChunks?: number;
  chunkBytes?: number;
  expected: EvidenceRange[];
  rationale: string;
};

export type ContextFixture = {
  version: number;
  cases: ContextFixtureCase[];
};

export type ContextObservation = {
  id: string;
  latencyMs: number;
  requestBytes: number;
  requestTokensProxy: number;
  mcpCallBytes: number;
  mcpCallTokensProxy: number;
  outputBytes: number | null;
  outputTokensProxy: number | null;
  mcpResponseBytes: number | null;
  mcpResponseTokensProxy: number | null;
  candidateReadBytes: number;
  selected: EvidenceRange[];
  recoveryRefs: EvidenceRange[];
  models: string[] | null;
  calls: number | null;
  coverage: Record<string, unknown> | null;
  providerUsage: { input_tokens: number; output_tokens: number } | null;
  quality: {
    evidenceRecall: number;
    filePrecision: number | null;
    withheldRecoverability: number | null;
  } | null;
  error?: string;
};

export type ContextEvaluationResult = {
  observations: ContextObservation[];
  errors: number;
};

function lines(items: EvidenceRange[]): Set<string> {
  const result = new Set<string>();
  for (const item of items)
    for (let line = item.startLine; line <= item.endLine; line += 1)
      result.add(`${item.path}:${line}`);
  return result;
}

function validatePath(root: string, item: string): void {
  if (!item || isAbsolute(item) || item.split(/[\\/]/).includes(".."))
    throw new Error(`invalid fixture path: ${item}`);
  const rel = relative(root, resolve(root, item));
  if (!rel || rel.startsWith("..")) throw new Error(`fixture path escapes root: ${item}`);
}

function validateRange(
  root: string,
  item: EvidenceRange,
  files: Map<string, number>,
  allowedPaths: Set<string>,
): void {
  validatePath(root, item.path);
  if (!allowedPaths.has(item.path))
    throw new Error(`evidence path is not a case path: ${item.path}`);
  const lineCount = files.get(item.path);
  if (!lineCount || !Number.isInteger(item.startLine) || !Number.isInteger(item.endLine))
    throw new Error(`evidence file is missing: ${item.path}`);
  if (item.startLine < 1 || item.endLine < item.startLine || item.endLine > lineCount)
    throw new Error(`evidence range is outside file: ${item.path}`);
}

export async function validateContextFixtures(
  fixturePath = resolve("fixtures/context-evaluation/fixture.json"),
): Promise<ContextFixture> {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as ContextFixture;
  if (fixture.version !== 1 || !Array.isArray(fixture.cases) || fixture.cases.length < 4)
    throw new Error("context fixture must be version 1 with at least four cases");
  const root = resolve(fixturePath, "..");
  const allPaths = fixture.cases.flatMap((entry) => entry.paths);
  for (const item of allPaths) validatePath(root, item);
  const files = new Map<string, number>();
  for (const item of allPaths) {
    if (files.has(item)) continue;
    const content = await readFile(resolve(root, item), "utf8");
    files.set(item, content.split("\n").length);
  }
  const ids = new Set<string>();
  for (const item of fixture.cases) {
    if (ids.has(item.id)) throw new Error(`duplicate context fixture case: ${item.id}`);
    ids.add(item.id);
    contextInputSchema.parse({
      query: item.query,
      paths: item.paths,
      maxFiles: item.maxFiles ?? 32,
      maxChunks: item.maxChunks ?? 24,
      chunkBytes: item.chunkBytes ?? 4096,
    });
    if (!item.rationale.trim() || item.expected.length === 0)
      throw new Error(`case requires rationale and expected evidence: ${item.id}`);
    for (const expected of item.expected) validateRange(root, expected, files, new Set(item.paths));
  }
  return fixture;
}

function run(
  binary: string,
  root: string,
  input: unknown,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [binary, "context", "--root", root, "--input", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => done({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

export function scoreContextObservation(
  fixture: ContextFixtureCase,
  result: { selected?: EvidenceRange[]; recoveryRefs?: EvidenceRange[] },
): ContextObservation["quality"] {
  const selected = result.selected ?? [];
  const refs = result.recoveryRefs ?? [];
  const expectedLines = lines(fixture.expected);
  const selectedLines = lines(selected);
  const referenceLines = lines(refs);
  const coveredLines = [...expectedLines].filter((line) => selectedLines.has(line));
  const withheldLines = [...expectedLines].filter((line) => !selectedLines.has(line));
  const recoveredWithheldLines = withheldLines.filter((line) => referenceLines.has(line));
  const expectedFiles = new Set(fixture.expected.map((item) => item.path));
  const selectedFiles = new Set(selected.map((item) => item.path));
  return {
    evidenceRecall: expectedLines.size ? coveredLines.length / expectedLines.size : 0,
    filePrecision: selectedFiles.size
      ? [...selectedFiles].filter((path) => expectedFiles.has(path)).length / selectedFiles.size
      : null,
    withheldRecoverability: withheldLines.length
      ? recoveredWithheldLines.length / withheldLines.length
      : null,
  };
}

export async function runContextEvaluation(
  binary: string,
  tokenizer: { encode(text: string): unknown[] },
  fixturePath = resolve("fixtures/context-evaluation/fixture.json"),
): Promise<ContextEvaluationResult> {
  const fixture = await validateContextFixtures(fixturePath);
  const root = resolve(fixturePath, "..");
  const observations: ContextObservation[] = [];
  for (const item of fixture.cases) {
    const input = {
      query: item.query,
      paths: item.paths,
      maxFiles: item.maxFiles ?? 32,
      maxChunks: item.maxChunks ?? 24,
      chunkBytes: item.chunkBytes ?? 4096,
    };
    const request = JSON.stringify(input);
    const mcpCall = JSON.stringify({
      method: "tools/call",
      params: { name: "jev_context", arguments: input },
    });
    const started = performance.now();
    const result = await run(binary, root, input);
    const latencyMs = Math.round(performance.now() - started);
    const candidateReadBytes = (
      await Promise.all(
        item.paths.map(async (path) => Buffer.byteLength(await readFile(resolve(root, path)))),
      )
    ).reduce((total, bytes) => total + bytes, 0);
    const common = {
      id: item.id,
      latencyMs,
      requestBytes: Buffer.byteLength(request),
      requestTokensProxy: tokenizer.encode(request).length,
      mcpCallBytes: Buffer.byteLength(mcpCall),
      mcpCallTokensProxy: tokenizer.encode(mcpCall).length,
      candidateReadBytes,
    };
    if (result.code !== 0) {
      observations.push({
        ...common,
        outputBytes: null,
        outputTokensProxy: null,
        mcpResponseBytes: null,
        mcpResponseTokensProxy: null,
        selected: [],
        recoveryRefs: [],
        models: null,
        calls: null,
        coverage: null,
        providerUsage: null,
        quality: null,
        error: result.stderr.slice(0, 240),
      });
      continue;
    }
    let parsed: z.infer<typeof responseSchema>;
    let raw: unknown;
    try {
      raw = JSON.parse(result.stdout);
      parsed = responseSchema.parse(raw);
    } catch {
      observations.push({
        ...common,
        outputBytes: Buffer.byteLength(result.stdout),
        outputTokensProxy: tokenizer.encode(result.stdout).length,
        mcpResponseBytes: null,
        mcpResponseTokensProxy: null,
        selected: [],
        recoveryRefs: [],
        models: null,
        calls: null,
        coverage: null,
        providerUsage: null,
        quality: null,
        error: "malformed context response",
      });
      continue;
    }
    const selected = parsed.selected ?? [];
    const recoveryRefs = parsed.recoveryRefs ?? [];
    const mcpResponse = JSON.stringify({
      content: [{ type: "text", text: result.stdout.trim() }],
      structuredContent: raw,
    });
    observations.push({
      ...common,
      outputBytes: Buffer.byteLength(result.stdout),
      outputTokensProxy: tokenizer.encode(result.stdout).length,
      mcpResponseBytes: Buffer.byteLength(mcpResponse),
      mcpResponseTokensProxy: tokenizer.encode(mcpResponse).length,
      selected,
      recoveryRefs,
      models: parsed.evaluations.models,
      calls: parsed.evaluations?.calls ?? null,
      coverage: parsed.coverage ?? null,
      providerUsage:
        parsed.evaluations?.usage &&
        typeof parsed.evaluations.usage.input_tokens === "number" &&
        typeof parsed.evaluations.usage.output_tokens === "number"
          ? {
              input_tokens: parsed.evaluations.usage.input_tokens,
              output_tokens: parsed.evaluations.usage.output_tokens,
            }
          : null,
      quality: scoreContextObservation(item, { selected, recoveryRefs }),
    });
  }
  return { observations, errors: observations.filter((item) => item.quality === null).length };
}

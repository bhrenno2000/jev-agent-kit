import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, win32 } from "node:path";
import { z } from "zod";
import type { JevClient } from "./core/index.js";

const MAX_EVALUATED_CHUNKS = 24;
const MAX_STATE_BYTES = 24 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_FILE_BYTES = 512 * 1024;
const excluded = new Set([".git", "node_modules", "dist", "build", ".next", "coverage"]);
const textExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".yaml",
  ".yml",
]);
const secretPath = /(^|[._-])(env|pem|key|secret|token|credential)s?($|[._-])/i;
const secretName =
  /(^|[./_-])(?:\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\..*)?|.*\.pem|.*\.key)(?:$|[./_-])/i;

export const contextInputSchema = z
  .object({
    query: z.string().trim().min(1).max(4096),
    paths: z.array(z.string().min(1).max(512)).min(1).max(128),
    maxFiles: z.number().int().min(1).max(128).default(32),
    maxChunks: z.number().int().min(1).max(MAX_EVALUATED_CHUNKS).default(MAX_EVALUATED_CHUNKS),
    chunkBytes: z.number().int().min(512).max(8192).default(4096),
  })
  .strict();
export type ContextInput = z.input<typeof contextInputSchema>;
type FileReport = {
  path: string;
  status: string;
  reason?: string;
  chunks?: number;
  evaluatedChunks?: number;
};
type Chunk = { path: string; startLine: number; endLine: number; content: string };
type Scored = Chunk & { digest: string; score: number; uncertain: boolean };

function isSecret(path: string): boolean {
  return secretPath.test(path) || secretName.test(path);
}

function safeRelative(root: string, candidate: string): string {
  if (
    candidate.includes("\0") ||
    isAbsolute(candidate) ||
    win32.isAbsolute(candidate) ||
    candidate.startsWith("~")
  )
    throw new Error("path must be relative");
  const normalized = resolve(root, candidate);
  const rel = relative(root, normalized);
  if (!rel || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\"))
    throw new Error("path is outside root");
  if (rel.split(/[\\/]/).some((part) => excluded.has(part) || part === "." || part === ".."))
    throw new Error("path is excluded");
  return rel;
}

async function assertContained(root: string, absolute: string): Promise<void> {
  const resolved = await realpath(absolute);
  const rel = relative(root, resolved);
  if (!rel || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\"))
    throw new Error("path is outside root");
}

async function assertNoSymlink(root: string, rel: string): Promise<void> {
  let current = root;
  for (const part of rel.split(/[\\/]/)) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("symbolic links are not allowed");
  }
}

function splitLines(
  path: string,
  text: string,
  maxBytes: number,
): { chunks: Chunk[]; reason?: string } {
  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const chunks: Chunk[] = [];
  let current: string[] = [];
  let bytes = 0;
  let start = 1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes > maxBytes) return { chunks: [], reason: "line exceeds chunk limit" };
    const extra = current.length === 0 ? lineBytes : lineBytes + 1;
    if (current.length > 0 && bytes + extra > maxBytes) {
      chunks.push({ path, startLine: start, endLine: index, content: current.join("\n") });
      current = [];
      bytes = 0;
      start = index + 1;
    }
    current.push(line);
    bytes += current.length === 1 ? lineBytes : lineBytes + 1;
  }
  if (current.length > 0)
    chunks.push({ path, startLine: start, endLine: lines.length, content: current.join("\n") });
  return { chunks };
}

async function readText(root: string, rel: string): Promise<{ text?: string; reason?: string }> {
  const absolute = resolve(root, rel);
  let handle;
  try {
    await assertContained(root, absolute);
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile()) return { reason: "not a regular file" };
    if (before.size > MAX_FILE_BYTES) return { reason: "file exceeds 512 KiB" };
    const target = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < before.size) {
      const read = await handle.read(target, offset, before.size - offset, offset);
      if (read.bytesRead === 0) return { reason: "short read" };
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    if (
      !after.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      return { reason: "file changed during read" };
    if (target.subarray(0, offset).includes(0)) return { reason: "binary content" };
    const text = new TextDecoder("utf-8", { fatal: true }).decode(target.subarray(0, offset));
    await assertContained(root, absolute);
    return { text };
  } catch (error) {
    if (error instanceof TypeError) return { reason: "invalid UTF-8" };
    if (
      error instanceof Error &&
      ["path is outside root", "symbolic links are not allowed"].includes(error.message)
    )
      throw error;
    return { reason: "file cannot be opened safely" };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function scoreOf(answer: unknown): number {
  if (!answer || typeof answer !== "object" || !("noul" in answer)) return 0;
  const value = Number((answer as { noul: unknown }).noul);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}
function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function collectContext(
  client: JevClient,
  rootInput: string,
  input: ContextInput,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const parsed = contextInputSchema.parse(input);
  if (signal?.aborted) throw new Error("request aborted");
  const root = await realpath(resolve(rootInput));
  const reports: FileReport[] = [];
  const candidates: Chunk[] = [];
  let consideredFiles = 0;
  let omitted = 0;
  let evaluationCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const models = new Set<string>();
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(), 60_000);
  const abortUser = () => deadline.abort(signal?.reason);
  signal?.addEventListener("abort", abortUser, { once: true });
  try {
    for (const requested of parsed.paths) {
      if (signal?.aborted) throw new Error("request aborted");
      if (consideredFiles >= parsed.maxFiles) {
        omitted += 1;
        reports.push({ path: requested, status: "omitted", reason: "maxFiles reached" });
        continue;
      }
      let rel: string;
      try {
        rel = safeRelative(root, requested);
        await assertNoSymlink(root, rel);
      } catch (error) {
        reports.push({
          path: requested,
          status: "skipped",
          reason:
            error instanceof Error
              ? error.message === "path is outside root" ||
                error.message === "path must be relative" ||
                error.message === "path is excluded" ||
                error.message === "symbolic links are not allowed"
                ? error.message
                : "invalid path"
              : "invalid path",
        });
        continue;
      }
      if (isSecret(rel)) {
        reports.push({ path: rel, status: "skipped", reason: "sensitive path" });
        continue;
      }
      if (!textExtensions.has(extname(rel).toLowerCase())) {
        reports.push({ path: rel, status: "skipped", reason: "unsupported text extension" });
        continue;
      }
      const loaded = await readText(root, rel);
      if (!loaded.text) {
        reports.push({
          path: rel,
          status: "skipped",
          reason: loaded.reason ?? "file cannot be read",
        });
        continue;
      }
      const split = splitLines(rel, loaded.text, parsed.chunkBytes);
      if (split.reason) {
        reports.push({ path: rel, status: "skipped", reason: split.reason });
        continue;
      }
      consideredFiles += 1;
      const available = Math.min(split.chunks.length, parsed.maxChunks - candidates.length);
      candidates.push(...split.chunks.slice(0, available));
      const skippedChunks = split.chunks.length - available;
      omitted += skippedChunks;
      reports.push({
        path: rel,
        status: skippedChunks > 0 ? "partially_considered" : "considered",
        chunks: split.chunks.length,
        evaluatedChunks: available,
      });
    }
    const scored: Scored[] = [];
    for (let offset = 0; offset < candidates.length;) {
      if (signal?.aborted) throw new Error("request aborted");
      const group = candidates.slice(offset, offset + 6);
      while (
        group.length > 1 &&
        Buffer.byteLength(
          JSON.stringify({
            query: parsed.query,
            chunks: group.map((chunk, index) => ({ id: `chunk_${index}`, ...chunk })),
          }),
          "utf8",
        ) > MAX_STATE_BYTES
      )
        group.pop();
      const state = {
        query: parsed.query,
        chunks: group.map((chunk, index) => ({ id: `chunk_${index}`, ...chunk })),
      };
      if (Buffer.byteLength(JSON.stringify(state), "utf8") > MAX_STATE_BYTES) {
        omitted += group.length;
        reports.push({
          path: "*",
          status: "omitted",
          reason: "evaluation state exceeds 24 KiB",
          chunks: group.length,
        });
        offset += group.length;
        continue;
      }
      const questions: Record<
        string,
        { type: "noul"; instructions: string; criteria: { true: string; false: string } }
      > = {};
      group.forEach((chunk, index) => {
        questions[`chunk_${index}`] = {
          type: "noul",
          instructions: `Does chunk ${index} at ${chunk.path}:${chunk.startLine}-${chunk.endLine} provide evidence for the query?`,
          criteria: { true: "Useful evidence", false: "Not useful evidence" },
        };
      });
      const result = await client.evaluate({ state, questions }, deadline.signal);
      evaluationCalls += 1;
      inputTokens += result.usage.input_tokens;
      outputTokens += result.usage.output_tokens;
      models.add(result.model);
      group.forEach((chunk, index) => {
        const score = scoreOf(result.answers[`chunk_${index}`]);
        scored.push({ ...chunk, score, digest: digest(chunk.content), uncertain: score < 0.65 });
      });
      offset += group.length;
    }
    scored.sort(
      (a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine,
    );
    let selected = scored.filter((item) => item.score >= 0.35);
    let files = reports;
    let query = parsed.query;
    let queryOmitted = false;
    const base = () => ({
      query,
      ...(queryOmitted ? { queryOmitted: true } : {}),
      root: "pinned",
      selected,
      files,
      counts: {
        requestedFiles: parsed.paths.length,
        consideredFiles,
        evaluatedChunks: scored.length,
        selectedChunks: selected.length,
        omitted,
      },
      evaluations: {
        calls: evaluationCalls,
        models: [...models],
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      },
      incomplete: omitted > 0 || reports.some((report) => report.status === "skipped"),
      advisory: true,
    });
    while (
      Buffer.byteLength(JSON.stringify(base()), "utf8") > MAX_OUTPUT_BYTES &&
      selected.length > 0
    ) {
      selected = selected.slice(0, -1);
      omitted += 1;
    }
    while (
      Buffer.byteLength(JSON.stringify(base()), "utf8") > MAX_OUTPUT_BYTES &&
      files.length > 0
    ) {
      files = files.slice(0, -1);
      omitted += 1;
    }
    if (Buffer.byteLength(JSON.stringify(base()), "utf8") > MAX_OUTPUT_BYTES && query.length > 0) {
      query = "";
      queryOmitted = true;
    }
    if (Buffer.byteLength(JSON.stringify(base()), "utf8") > MAX_OUTPUT_BYTES)
      throw new Error("context response exceeds 16 KiB");
    return base();
  } finally {
    clearTimeout(deadlineTimer);
    signal?.removeEventListener("abort", abortUser);
  }
}

import { z } from "zod";
import { open } from "node:fs/promises";
import { constants } from "node:fs";

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
) as z.ZodType<JsonValue>;

const instructionsSchema = z.string().trim().min(1).max(4096);
const questionIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const noulSchema = z
  .object({
    type: z.literal("noul"),
    instructions: instructionsSchema,
    criteria: z
      .object({
        true: z.string().trim().min(1).max(2048),
        false: z.string().trim().min(1).max(2048),
      })
      .strict()
      .optional(),
  })
  .strict();
const choiceSchema = z
  .object({
    type: z.literal("choice"),
    instructions: instructionsSchema,
    criteria: z
      .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/), z.string().trim().min(1).max(2048))
      .refine((value) => Object.keys(value).length >= 2 && Object.keys(value).length <= 16),
  })
  .strict();
const scoreSchema = z
  .object({
    type: z.literal("score"),
    instructions: instructionsSchema,
    criteria: z.array(z.string().trim().min(1).max(2048)).min(2).max(10),
  })
  .strict();

export type Question =
  z.infer<typeof noulSchema> | z.infer<typeof choiceSchema> | z.infer<typeof scoreSchema>;
export type EvaluationInput = {
  state: string | Record<string, JsonValue> | JsonValue[];
  questions: Record<string, Question>;
};

export const evaluationInputSchema: z.ZodType<EvaluationInput> = z
  .object({
    state: z.union([
      z.string().min(1).max(24576),
      z.record(z.string(), jsonValueSchema),
      z.array(jsonValueSchema),
    ]),
    questions: z
      .record(
        questionIdSchema,
        z.discriminatedUnion("type", [noulSchema, choiceSchema, scoreSchema]),
      )
      .refine((value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 24),
  })
  .strict() as z.ZodType<EvaluationInput>;

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type ScoreAnswer = {
  type: "score";
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
  legend?: Record<string, string>;
};
export type EvaluationResult = {
  model: string;
  answers: Record<string, NoulAnswer | ChoiceAnswer | ScoreAnswer>;
  usage: { input_tokens: number; output_tokens: number };
  providerMetadata?: {
    gateway?: {
      cost?: string;
      marketCost?: string;
      surchargeCost?: string;
      gatewayCost?: string;
      generationId?: string;
    };
  };
  meta: { durationMs: number; attempts: number; advisory: true };
};

export class JevError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message.slice(0, 240));
    this.name = "JevError";
    this.code = code;
  }
}

const MAX_REQUEST_BYTES = 49152;
const MAX_RESPONSE_BYTES = 131072;
export type JevProvider = "typesafe" | "vercel";
const PROVIDER_ENDPOINTS: Record<JevProvider, string> = {
  typesafe: "https://api.typesafe.ai/v1/systemone",
  vercel: "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
};
const PROVIDER_MODELS: Record<JevProvider, string> = {
  typesafe: "jev-1.13.0",
  vercel: "typesafe-ai/jev",
};
const DEFAULT_TIMEOUT = 30000;

function isProvider(value: unknown): value is JevProvider {
  return value === "typesafe" || value === "vercel";
}

function providerFromEnvironment(): JevProvider {
  const value = process.env.JEV_PROVIDER ?? "typesafe";
  if (!isProvider(value))
    throw new JevError("invalid_provider", "Provider must be typesafe or vercel");
  return value;
}

function providerCredentialNames(provider: JevProvider): { env: string; file: string } {
  return provider === "vercel"
    ? { env: "AI_GATEWAY_API_KEY", file: "AI_GATEWAY_API_KEY_FILE" }
    : { env: "TYPESAFE_API_KEY", file: "TYPESAFE_API_KEY_FILE" };
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new JevError("invalid_timeout", "Timeout must be between 100 and 60000 milliseconds");
  return parsed;
}

function endpointIsAllowed(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const unsafePath =
      url.pathname.split("/").some((part) => part === ".." || part === ".") ||
      /%2e/i.test(url.pathname);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !unsafePath &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "[::1]")))
    );
  } catch {
    return false;
  }
}

function modelIsAllowed(model: string): boolean {
  return /^(?:[A-Za-z0-9._-]+)(?:\/[A-Za-z0-9._-]+)?$/.test(model) && model.length <= 80;
}

function gatewayDecimal(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    /^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,18})?$/.test(value)
  );
}

function gatewayGenerationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  );
}

function errorSummary(): string {
  return "Invalid evaluation input";
}

function finiteUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function distribution(value: unknown, keys: string[]): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  return (
    actual.length === keys.length &&
    keys.every(
      (key) => Object.prototype.hasOwnProperty.call(record, key) && finiteUnit(record[key]),
    ) &&
    Math.abs(keys.reduce((sum, key) => sum + Number(record[key]), 0) - 1) <= 0.02
  );
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function waitWithAbort(delay: number, signal: AbortSignal, abortedCode: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, delay);
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        new JevError(
          abortedCode,
          abortedCode === "aborted" ? "Request was aborted" : "Request timed out",
        ),
      );
    };
    function done() {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw new JevError("timeout", "Provider request timed out");
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new JevError("timeout", "Provider request timed out"));
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function readBounded(response: Response, signal: AbortSignal): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES)
    throw new JevError("response_too_large", "Provider response exceeded the size limit");
  if (!response.body)
    throw new JevError("invalid_response", "Provider response body is unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await readWithAbort(reader, signal);
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new JevError("response_too_large", "Provider response exceeded the size limit");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof JevError) throw error;
    throw new JevError("response_read_error", "Provider response could not be read");
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buffer);
}

function inspectInput(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
  budget = { count: 0, bytes: 0 },
): void {
  if (depth > 32) throw new JevError("invalid_input", "Evaluation input is too deeply nested");
  budget.count += 1;
  if (budget.count > 10000) throw new JevError("invalid_input", "Evaluation input is too complex");
  if (typeof value === "string") budget.bytes += new TextEncoder().encode(value).byteLength;
  if (value && typeof value === "object") {
    if (seen.has(value)) throw new JevError("invalid_input", "Evaluation input is cyclic");
    seen.add(value);
    if (Array.isArray(value)) for (const item of value) inspectInput(item, depth + 1, seen, budget);
    else
      for (const [key, item] of Object.entries(value)) {
        budget.bytes += new TextEncoder().encode(key).byteLength;
        inspectInput(item, depth + 1, seen, budget);
      }
    seen.delete(value);
  }
  if (budget.bytes > MAX_REQUEST_BYTES)
    throw new JevError("request_too_large", "Request exceeded the size limit");
}

async function readCredentialFile(path: string): Promise<string> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new JevError("missing_api_key", "Provider API key is not configured");
    const buffer = Buffer.alloc(4097);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    if (result.bytesRead > 4096)
      throw new JevError("missing_api_key", "Provider API key is not configured");
    const raw = buffer.subarray(0, result.bytesRead).toString("utf8");
    const value = raw.trim();
    if (/[\r\n]/.test(value))
      throw new JevError("missing_api_key", "Provider API key is not configured");
    if (!value || value.length > 4096)
      throw new JevError("missing_api_key", "Provider API key is not configured");
    return value;
  } catch (error) {
    if (error instanceof JevError) throw error;
    throw new JevError("missing_api_key", "Provider API key is not configured");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseResult(value: unknown, input: EvaluationInput): Omit<EvaluationResult, "meta"> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new JevError("invalid_response", "Provider response has an invalid shape");
  const body = value as Record<string, unknown>;
  if (
    typeof body.model !== "string" ||
    !modelIsAllowed(body.model) ||
    !body.answers ||
    typeof body.answers !== "object" ||
    Array.isArray(body.answers)
  )
    throw new JevError("invalid_response", "Provider response has an invalid shape");
  const usage = body.usage as Record<string, unknown> | undefined;
  if (
    !usage ||
    !Number.isSafeInteger(usage.input_tokens) ||
    !Number.isSafeInteger(usage.output_tokens) ||
    Number(usage.input_tokens) < 0 ||
    Number(usage.output_tokens) < 0
  )
    throw new JevError("invalid_response", "Provider response usage is invalid");
  const answers = body.answers as Record<string, unknown>;
  const expected = Object.keys(input.questions);
  if (
    Object.keys(answers).length !== expected.length ||
    expected.some((key) => !Object.prototype.hasOwnProperty.call(answers, key))
  )
    throw new JevError("invalid_response", "Provider response answers do not match the request");
  const parsed: Record<string, NoulAnswer | ChoiceAnswer | ScoreAnswer> = {};
  for (const [id, question] of Object.entries(input.questions)) {
    const answer = answers[id];
    if (!answer || typeof answer !== "object" || Array.isArray(answer))
      throw new JevError("invalid_response", "Provider answer has an invalid shape");
    const row = answer as Record<string, unknown>;
    if (row.type !== question.type)
      throw new JevError("invalid_response", "Provider answer type does not match the request");
    if (question.type === "noul") {
      if (!finiteUnit(row.noul))
        throw new JevError("invalid_response", "Provider noul answer is invalid");
      parsed[id] = { type: "noul", noul: row.noul };
    } else if (question.type === "choice") {
      const keys = Object.keys(question.criteria);
      if (
        typeof row.choice !== "string" ||
        !keys.includes(row.choice) ||
        !distribution(row.probabilities, keys) ||
        !finiteUnit(row.confidence)
      )
        throw new JevError("invalid_response", "Provider choice answer is invalid");
      parsed[id] = {
        type: "choice",
        choice: row.choice,
        probabilities: row.probabilities as Record<string, number>,
        confidence: row.confidence,
      };
    } else {
      const keys = question.criteria.map((_, index) => String(index));
      if (
        typeof row.score !== "number" ||
        !Number.isFinite(row.score) ||
        row.score < 0 ||
        row.score > question.criteria.length - 1 ||
        !distribution(row.probabilities, keys) ||
        !finiteUnit(row.confidence)
      )
        throw new JevError("invalid_response", "Provider score answer is invalid");
      const result: ScoreAnswer = {
        type: "score",
        score: row.score,
        probabilities: row.probabilities as Record<string, number>,
        confidence: row.confidence,
      };
      if (row.legend !== undefined) {
        if (
          !row.legend ||
          typeof row.legend !== "object" ||
          Array.isArray(row.legend) ||
          Object.keys(row.legend as object).length !== keys.length ||
          keys.some(
            (key) =>
              typeof (row.legend as Record<string, unknown>)[key] !== "string" ||
              String((row.legend as Record<string, unknown>)[key]).length > 2048 ||
              (row.legend as Record<string, unknown>)[key] !== question.criteria[Number(key)],
          )
        )
          throw new JevError("invalid_response", "Provider score legend is invalid");
        result.legend = row.legend as Record<string, string>;
      }
      parsed[id] = result;
    }
  }
  const providerMetadata = parseGatewayMetadata(body.provider_metadata);
  return {
    model: body.model,
    answers: parsed,
    usage: {
      input_tokens: usage.input_tokens as number,
      output_tokens: usage.output_tokens as number,
    },
    ...(providerMetadata ? { providerMetadata } : {}),
  };
}

function parseGatewayMetadata(value: unknown): EvaluationResult["providerMetadata"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const gateway = (value as Record<string, unknown>).gateway;
  if (!gateway || typeof gateway !== "object" || Array.isArray(gateway)) return undefined;
  const source = gateway as Record<string, unknown>;
  const allowed = ["cost", "marketCost", "surchargeCost", "gatewayCost", "generationId"] as const;
  const result: NonNullable<EvaluationResult["providerMetadata"]>["gateway"] = {};
  for (const key of allowed) {
    const valid =
      key === "generationId" ? gatewayGenerationId(source[key]) : gatewayDecimal(source[key]);
    if (valid) result[key] = source[key] as string;
  }
  return Object.keys(result).length > 0 ? { gateway: result } : undefined;
}

export class JevClient {
  private readonly provider: JevProvider;
  private readonly apiKey: string | undefined;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly model: string;
  private readonly requestFetch: typeof fetch;

  constructor(
    options: {
      apiKey?: string | undefined;
      provider?: JevProvider | undefined;
      endpoint?: string | undefined;
      timeoutMs?: number | undefined;
      model?: string | undefined;
      fetch?: typeof fetch | undefined;
    } = {},
  ) {
    this.provider = options.provider ?? providerFromEnvironment();
    if (!isProvider(this.provider))
      throw new JevError("invalid_provider", "Provider must be typesafe or vercel");
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? PROVIDER_ENDPOINTS[this.provider];
    if (!endpointIsAllowed(this.endpoint))
      throw new JevError("invalid_endpoint", "Endpoint must use HTTPS or literal loopback HTTP");
    this.timeoutMs =
      options.timeoutMs ?? boundedInteger(process.env.JEV_TIMEOUT_MS, DEFAULT_TIMEOUT, 100, 60000);
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 60000)
      throw new JevError("invalid_timeout", "Timeout must be between 100 and 60000 milliseconds");
    this.model = options.model ?? process.env.JEV_MODEL ?? PROVIDER_MODELS[this.provider];
    if (!modelIsAllowed(this.model)) throw new JevError("invalid_model", "Model name is invalid");
    this.requestFetch = options.fetch ?? fetch;
  }

  status(): Record<string, unknown> {
    const credentials = providerCredentialNames(this.provider);
    const credentialSource = this.apiKey
      ? "explicit"
      : process.env[credentials.env]
        ? "env"
        : process.env[credentials.file]
          ? "file"
          : "none";
    return {
      provider: this.provider,
      endpoint: this.endpoint,
      model: this.model,
      timeoutMs: this.timeoutMs,
      credentialSource,
      configured: credentialSource !== "none",
      limits: {
        maxRequestBytes: MAX_REQUEST_BYTES,
        maxStateBytes: 24576,
        maxQuestions: 24,
        maxResponseBytes: MAX_RESPONSE_BYTES,
      },
    };
  }

  async evaluate(input: unknown, signal?: AbortSignal): Promise<EvaluationResult> {
    if (signal?.aborted) throw new JevError("aborted", "Request was aborted");
    try {
      inspectInput(input);
    } catch (error) {
      if (error instanceof JevError) throw error;
      throw new JevError("invalid_input", "Evaluation input is invalid");
    }
    let parsedInput: EvaluationInput;
    try {
      parsedInput = evaluationInputSchema.parse(input);
    } catch (error) {
      throw new JevError("invalid_input", errorSummary());
    }
    let serializedState: string;
    try {
      serializedState = JSON.stringify(parsedInput.state);
    } catch {
      throw new JevError("invalid_input", "Evaluation input is invalid");
    }
    const stateBytes = new TextEncoder().encode(serializedState).byteLength;
    if (stateBytes > 24576) throw new JevError("state_too_large", "State exceeded the size limit");
    const request = JSON.stringify({
      state: parsedInput.state,
      model: this.model,
      questions: parsedInput.questions,
    });
    if (new TextEncoder().encode(request).byteLength > MAX_REQUEST_BYTES)
      throw new JevError("request_too_large", "Request exceeded the size limit");
    const started = Date.now();
    const credentials = providerCredentialNames(this.provider);
    let key = this.apiKey ?? process.env[credentials.env];
    const filePath = process.env[credentials.file];
    if (!key && filePath) key = await readCredentialFile(filePath);
    if (key) key = key.trim();
    if (!key || /[\r\n]/.test(key) || key.trim().length > 4096)
      throw new JevError("missing_api_key", "Provider API key is not configured");
    if (signal?.aborted) throw new JevError("aborted", "Request was aborted");
    if (Date.now() >= started + this.timeoutMs)
      throw new JevError("timeout", "Provider request timed out");
    let attempts = 0;
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, this.timeoutMs - (Date.now() - started)),
    );
    try {
      for (;;) {
        attempts += 1;
        let response: Response;
        try {
          response = await this.requestFetch(this.endpoint, {
            method: "POST",
            redirect: "error",
            headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
            body: request,
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted)
            throw new JevError(
              signal?.aborted ? "aborted" : "timeout",
              signal?.aborted ? "Request was aborted" : "Request timed out",
            );
          throw new JevError("network_error", "Provider request failed");
        }
        if ((response.status === 429 || response.status === 503) && attempts < 2) {
          const delay = parseRetryAfter(response.headers.get("retry-after"));
          await response.body?.cancel().catch(() => undefined);
          if (delay === undefined || delay > 5000 || Date.now() + delay >= started + this.timeoutMs)
            throw new JevError("retry_unavailable", "Provider retry window exceeded");
          await waitWithAbort(delay, controller.signal, signal?.aborted ? "aborted" : "timeout");
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new JevError(
            `http_${response.status}`,
            `Provider request failed with status ${response.status}`,
          );
        }
        let text: string;
        try {
          text = await readBounded(response, controller.signal);
        } catch (error) {
          await response.body?.cancel().catch(() => undefined);
          if (error instanceof JevError) {
            if (error.code === "timeout" && signal?.aborted)
              throw new JevError("aborted", "Request was aborted");
            throw error;
          }
          throw new JevError("response_read_error", "Provider response could not be read");
        }
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          throw new JevError("invalid_response", "Provider response was not valid JSON");
        }
        return {
          ...parseResult(body, parsedInput),
          meta: { durationMs: Date.now() - started, attempts, advisory: true },
        };
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

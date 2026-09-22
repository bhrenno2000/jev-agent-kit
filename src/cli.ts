#!/usr/bin/env node
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { JevClient, JevError } from "./core/index.js";
import { collectContext } from "./context.js";
import { configText, doctor } from "./config.js";
import { serve } from "./server.js";
import { VERSION } from "./version.js";
import { EvidencePreparer } from "./prepare.js";

type Parsed = { command?: string; options: Record<string, string>; positional: string[] };

class CliFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function parse(argv: string[]): Parsed {
  const options: Record<string, string> = {};
  const positional: string[] = [];
  let command: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]!;
    if (!command && !item.startsWith("-")) {
      command = item;
      continue;
    }
    if (item === "--help" || item === "-h") options.help = "true";
    else if (item === "--version" || item === "-v") options.version = "true";
    else if (item.startsWith("--")) {
      const key = item.slice(2);
      if (!["root", "input", "client"].includes(key))
        throw new CliFailure("invalid_arguments", "unknown option");
      const value = argv[i + 1];
      if (value === undefined || (value.startsWith("-") && value !== "-"))
        throw new CliFailure("invalid_arguments", "missing option value");
      if (options[key] !== undefined) throw new CliFailure("invalid_arguments", "duplicate option");
      options[key] = value;
      i += 1;
    } else if (item.startsWith("-")) throw new CliFailure("invalid_arguments", "unknown option");
    else positional.push(item);
  }
  return command === undefined ? { options, positional } : { command, options, positional };
}

function help(): string {
  return "jev-agent serve --root PATH\njev-agent evaluate --input FILE\njev-agent context --root PATH --input FILE\njev-agent prepare --root PATH --input FILE\njev-agent doctor\njev-agent config --client codex|claude --root PATH\njev-agent --version";
}

async function inputFile(path: string | undefined): Promise<string> {
  if (!path) throw new CliFailure("invalid_arguments", "input is required");
  if (path === "-")
    return new Promise((resolveInput, reject) => {
      let value = "";
      const fail = (error: Error) => {
        process.stdin.removeAllListeners("data");
        process.stdin.removeAllListeners("end");
        process.stdin.removeAllListeners("error");
        process.stdin.destroy();
        reject(error);
      };
      process.stdin.setEncoding("utf8");
      const onData = (chunk: string) => {
        value += chunk;
        if (Buffer.byteLength(value) > 512 * 1024)
          fail(new CliFailure("input_too_large", "input exceeds 512 KiB"));
      };
      const onEnd = () => {
        process.stdin.removeListener("data", onData);
        process.stdin.removeListener("error", onError);
        resolveInput(value);
      };
      const onError = () => fail(new CliFailure("input_read_error", "input could not be read"));
      process.stdin.on("data", onData);
      process.stdin.once("end", onEnd);
      process.stdin.once("error", onError);
    });
  let handle;
  try {
    handle = await open(
      resolve(path),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    throw new CliFailure("input_read_error", "input could not be opened");
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 512 * 1024)
      throw new CliFailure("input_too_large", "input exceeds 512 KiB or is not a regular file");
    const buffer = Buffer.alloc(512 * 1024 + 1);
    const result = await handle.read({ buffer, offset: 0, length: buffer.length, position: 0 });
    if (result.bytesRead > 512 * 1024)
      throw new CliFailure("input_too_large", "input exceeds 512 KiB");
    return buffer.subarray(0, result.bytesRead).toString("utf8");
  } catch (error) {
    if (error instanceof CliFailure) throw error;
    throw new CliFailure("input_read_error", "input could not be read");
  } finally {
    await handle.close();
  }
}

export async function run(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parse(argv);
  if (parsed.options.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (parsed.options.help || !parsed.command) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  if (parsed.positional.length)
    throw new CliFailure("invalid_arguments", "unexpected positional argument");
  if (!["serve", "doctor", "config", "evaluate", "context", "prepare"].includes(parsed.command))
    throw new CliFailure("invalid_arguments", "unknown command");
  const allowed =
    parsed.command === "serve"
      ? new Set(["root", "help", "version"])
      : parsed.command === "context" || parsed.command === "prepare"
        ? new Set(["root", "input", "help", "version"])
        : parsed.command === "config"
          ? new Set(["root", "client", "help", "version"])
          : parsed.command === "evaluate"
            ? new Set(["input", "help", "version"])
            : new Set(["root", "help", "version"]);
  if (Object.keys(parsed.options).some((key) => !allowed.has(key)))
    throw new CliFailure("invalid_arguments", "unsupported option");
  if (parsed.command === "serve") {
    if (!parsed.options.root) throw new CliFailure("invalid_arguments", "root is required");
    await serve(resolve(parsed.options.root));
    return;
  }
  if (parsed.command === "doctor") {
    if (parsed.options.input || parsed.options.client)
      throw new CliFailure("invalid_arguments", "unsupported option");
    process.stdout.write(`${JSON.stringify(await doctor(parsed.options.root), null, 2)}\n`);
    return;
  }
  if (parsed.command === "config") {
    const client = parsed.options.client;
    if (client !== "codex" && client !== "claude")
      throw new CliFailure("invalid_arguments", "client must be codex or claude");
    if (!parsed.options.root) throw new CliFailure("invalid_arguments", "root is required");
    process.stdout.write(configText(client, parsed.options.root));
    return;
  }
  if (parsed.options.client) throw new CliFailure("invalid_arguments", "unsupported option");
  const text = await inputFile(parsed.options.input);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new CliFailure("invalid_json", "input is not valid JSON");
  }
  const client = new JevClient();
  if (parsed.command === "evaluate") {
    process.stdout.write(`${JSON.stringify(await client.evaluate(body))}\n`);
    return;
  }
  if (!parsed.options.root) throw new CliFailure("invalid_arguments", "root is required");
  if (parsed.command === "prepare") {
    process.stdout.write(
      `${JSON.stringify(await new EvidencePreparer(client).prepare(resolve(parsed.options.root), body))}\n`,
    );
    return;
  }
  process.stdout.write(
    `${JSON.stringify(await collectContext(client, resolve(parsed.options.root), body as never))}\n`,
  );
}

function errorCode(error: unknown): string {
  return error instanceof CliFailure
    ? error.code
    : error instanceof JevError
      ? error.code
      : "command_failed";
}

if (process.argv[1]) {
  let executable = "";
  try {
    executable = realpathSync(process.argv[1]);
  } catch {}
  if (executable && import.meta.url === pathToFileURL(executable).href)
    run().catch((error) => {
      process.stderr.write(
        `${JSON.stringify({ error: { code: errorCode(error), message: error instanceof CliFailure ? error.message : error instanceof JevError ? error.message : "command failed" } })}\n`,
      );
      process.exitCode = 1;
    });
}

import assert from "node:assert/strict";
import { chmod, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);

test("cli supports version and installed symlink execution", async () => {
  const entry = join(process.cwd(), "dist", "cli.js");
  await chmod(entry, 0o755);
  const temp = await mkdtemp(join(tmpdir(), "jev-cli-"));
  const link = join(temp, "jev-agent");
  await symlink(entry, link);
  const result = await run(link, ["--version"]);
  assert.equal(result.stdout.trim(), "0.2.1");
});

test("cli accepts bounded stdin input and returns a JSON error without credentials", async () => {
  const entry = join(process.cwd(), "dist", "cli.js");
  const child = spawn(process.execPath, [entry, "evaluate", "--input", "-"]);
  child.stdin.end(
    JSON.stringify({
      state: "x",
      questions: { check: { type: "noul", instructions: "Is this true?" } },
    }),
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exit = await new Promise<number>((resolveExit, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
  assert.equal(exit, 1);
  assert.equal(JSON.parse(stderr).error.code, "missing_api_key");
});

test("cli reports invalid JSON with a stable error code", async () => {
  const entry = join(process.cwd(), "dist", "cli.js");
  const child = spawn(process.execPath, [entry, "evaluate", "--input", "-"]);
  child.stdin.end("{");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exit = await new Promise<number>((resolveExit, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
  assert.equal(exit, 1);
  assert.equal(JSON.parse(stderr).error.code, "invalid_json");
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, it } from "node:test";

async function run(
  args: string[],
  input = "",
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve("dist/cli.js"), ...args], {
      env: {
        ...process.env,
        TYPESAFE_API_KEY: undefined,
        TYPESAFE_API_KEY_FILE: undefined,
        ...env,
      },
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
    child.stdin.end(input);
  });
}

describe("CLI acceptance contract", () => {
  it("reports help and version without credentials", async () => {
    const help = await run(["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /jev-agent evaluate/);
    const version = await run(["--version"]);
    assert.equal(version.code, 0);
    assert.match(version.stdout, /^0\.1\.0\n$/);
  });

  it("returns bounded JSON errors for missing credentials and malformed input", async () => {
    const missing = await run(
      ["evaluate", "--input", "-"],
      JSON.stringify({
        state: "secret state",
        questions: { x: { type: "noul", instructions: "Is this true?" } },
      }),
    );
    assert.notEqual(missing.code, 0);
    assert.match(missing.stderr, /missing_api_key|not configured|command failed/);
    assert.doesNotMatch(missing.stderr, /secret state/);
    const malformed = await run(["evaluate", "--input", "-"], '{"state":');
    assert.notEqual(malformed.code, 0);
    assert.doesNotMatch(malformed.stderr, /SyntaxError|state/);
  });
});

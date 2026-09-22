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
        AI_GATEWAY_API_KEY: undefined,
        AI_GATEWAY_API_KEY_FILE: undefined,
        JEV_PROVIDER: undefined,
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
    assert.match(version.stdout, /^0\.3\.0\n$/);
  });

  it("reports the selected provider and passes provider variables through Codex config", async () => {
    const status = await run(["doctor"], "", {
      JEV_PROVIDER: "vercel",
      AI_GATEWAY_API_KEY_FILE: "/private/path/to/key",
    });
    assert.equal(status.code, 0);
    const parsed = JSON.parse(status.stdout);
    assert.equal(parsed.provider, "vercel");
    assert.equal(parsed.credentialSource, "file");
    assert.equal(parsed.model, "typesafe-ai/jev");
    assert.doesNotMatch(status.stdout, /private\/path/);
    const config = await run(["config", "--client", "codex", "--root", "/tmp/project"]);
    assert.equal(config.code, 0);
    assert.match(config.stdout, /"JEV_PROVIDER"/);
    assert.match(config.stdout, /"AI_GATEWAY_API_KEY_FILE"/);
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

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

async function discover(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? discover(path) : entry.name.endsWith(".test.ts") ? [path] : [];
    }),
  );
  return nested.flat().sort();
}

const files = await discover("test");
if (!files.length) throw new Error("No test files found");
const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
  env: {
    ...process.env,
    JEV_PROVIDER: undefined,
    JEV_MODEL: undefined,
    JEV_TIMEOUT_MS: undefined,
    TYPESAFE_API_KEY: undefined,
    TYPESAFE_API_KEY_FILE: undefined,
    AI_GATEWAY_API_KEY: undefined,
    AI_GATEWAY_API_KEY_FILE: undefined,
  },
});
child.on("error", () => {
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

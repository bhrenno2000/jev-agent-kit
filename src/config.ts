import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { JevClient } from "./core/index.js";

export type CredentialSource = "env" | "file" | "none";

export function credentialSource(): CredentialSource {
  if (process.env.TYPESAFE_API_KEY) return "env";
  if (process.env.TYPESAFE_API_KEY_FILE) return "file";
  return "none";
}

export async function doctor(root?: string): Promise<Record<string, unknown>> {
  const resolvedRoot = root ? resolve(root) : undefined;
  let rootReadable = false;
  if (resolvedRoot) {
    try {
      const info = await stat(resolvedRoot);
      rootReadable = info.isDirectory();
    } catch {}
  }
  const client = new JevClient();
  return {
    ...client.status(),
    credentialSource: credentialSource(),
    root: resolvedRoot ?? null,
    rootReadable,
  };
}

export function configText(
  client: "codex" | "claude",
  root: string,
  entrypoint = process.argv[1] ?? "jev-agent",
): string {
  const absoluteEntrypoint = resolve(entrypoint);
  const node = process.execPath;
  if (client === "codex")
    return `[mcp_servers.jev_agent_kit]\ncommand = ${JSON.stringify(node)}\nargs = [${JSON.stringify(absoluteEntrypoint)}, "serve", "--root", ${JSON.stringify(resolve(root))}]\nenv_vars = ["TYPESAFE_API_KEY", "TYPESAFE_API_KEY_FILE", "JEV_MODEL", "JEV_TIMEOUT_MS"]\n`;
  return (
    JSON.stringify(
      {
        mcpServers: {
          jev_agent_kit: {
            command: node,
            args: [absoluteEntrypoint, "serve", "--root", resolve(root)],
          },
        },
      },
      null,
      2,
    ) + "\n"
  );
}

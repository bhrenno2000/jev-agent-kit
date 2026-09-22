import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

async function discover(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? discover(path)
        : /\.[cm]?[jt]sx?$/.test(entry.name)
          ? [path]
          : [];
    }),
  );
  return nested.flat();
}

const files = (await Promise.all(["src", "scripts", "test", "fixtures"].map(discover))).flat();
const failures: string[] = [];
for (const file of files) {
  const text = await readFile(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const positions = new Set<number>();
  const visit = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) positions.add(range.pos);
    for (const range of ts.getTrailingCommentRanges(text, node.end) ?? []) positions.add(range.pos);
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const position of positions)
    failures.push(`${file}:${source.getLineAndCharacterOfPosition(position).line + 1}`);
}
if (failures.length) {
  process.stderr.write(`Source comments are not allowed:\n${failures.join("\n")}\n`);
  process.exitCode = 1;
} else process.stdout.write(`Comment policy passed for ${files.length} source files\n`);

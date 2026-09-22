import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, win32 } from "node:path";
import ts from "typescript";

const MAX_FILES = 64;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const DEFAULT_OUTPUT_BYTES = 16000;
const MAX_OUTPUT_BYTES = 24000;
const MAX_METADATA_ITEMS = 16;
const MAX_BLOCKS = 64;
const MAX_GRAPH_EDGES = 256;
const excluded = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".codex",
  ".agents",
]);
const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const secret =
  /(^|[./_-])(?:\.env(?:\..*)?|.*\.(?:pem|key|crt|p12)|credentials(?:\..*)?|secrets?|(?:id_)?(?:rsa|ed25519)|(?:api|auth|access|secret|private)[_-]?key|tokens?)(?:$|[./_-])/i;

export type StructureInput = { query: string; paths: string[]; maxBytes?: number };
export type StructureBlock = {
  path: string;
  startLine: number;
  endLine: number;
  kind: "import" | "declaration";
  name?: string;
  content: string;
  sha256: string;
  symbols: string[];
  dependencies: string[];
  score: number;
  exactMatch: boolean;
};
export type StructureResult = {
  root: "pinned";
  query: string;
  snapshot: string;
  sources: Array<{
    path: string;
    sha256: string;
    bytes: number;
    dependencies: string[];
    unresolvedDependencies: string[];
    dependencyRecordsOmitted: number;
    blocks: number;
    syntaxErrors: number;
  }>;
  selected: StructureBlock[];
  recoveryRefs: Array<
    Pick<StructureBlock, "path" | "startLine" | "endLine" | "sha256" | "score"> & {
      reason: "output_budget" | "unscanned";
    }
  >;
  skipped: Array<{ path: string; reason: string }>;
  coverage: {
    requestedFiles: number;
    scannedFiles: number;
    returnedBlocks: number;
    omittedBlocks: number;
    unscannedFiles: number;
    skippedFiles: number;
    skippedRecordsOmitted: number;
    unresolvedDependencies: number;
    recoveryRefsOmitted: number;
    sourceRecordsOmitted: number;
  };
  incomplete: boolean;
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function safeRelative(root: string, input: string): string {
  if (
    !input ||
    input.includes("\0") ||
    isAbsolute(input) ||
    win32.isAbsolute(input) ||
    input.startsWith("~")
  )
    throw new Error("path must be relative");
  const rel = relative(root, resolve(root, input));
  if (!rel || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\"))
    throw new Error("path is outside root");
  if (rel.split(/[\\/]/).some((part) => excluded.has(part) || part === "." || part === ".."))
    throw new Error("path is excluded");
  return rel;
}
function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    Boolean(rel) &&
    rel !== ".." &&
    !rel.startsWith("../") &&
    !rel.startsWith("..\\") &&
    !isAbsolute(rel)
  );
}
async function noSymlink(root: string, rel: string): Promise<void> {
  let current = root;
  for (const part of rel.split(/[\\/]/)) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("symbolic links are not allowed");
  }
}
async function readSafe(root: string, rel: string): Promise<{ text: string; bytes: number }> {
  const path = resolve(root, rel);
  await noSymlink(root, rel);
  const checked = await realpath(path);
  if (!contained(root, checked)) throw new Error("path is outside root");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await realpath(path);
    if (!contained(root, opened)) throw new Error("path moved outside root");
    const before = await handle.stat();
    const current = await lstat(path);
    if (before.dev !== current.dev || before.ino !== current.ino)
      throw new Error("file changed before read");
    if (!before.isFile() || before.size > MAX_FILE_BYTES) throw new Error("file exceeds limit");
    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < before.size) {
      const read = await handle.read(buffer, offset, before.size - offset, offset);
      if (!read.bytesRead) throw new Error("short read");
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    const finalPath = await realpath(path);
    await noSymlink(root, rel);
    const finalLstat = await lstat(path);
    if (
      !contained(root, finalPath) ||
      before.dev !== finalLstat.dev ||
      before.ino !== finalLstat.ino
    )
      throw new Error("file changed during read");
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error("file changed during read");
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer), bytes: offset };
  } finally {
    await handle.close();
  }
}
function lineAt(text: string, position: number): number {
  return text.slice(0, position).split("\n").length;
}
function names(node: ts.Node): string[] {
  const result: string[] = [];
  if (ts.isImportDeclaration(node)) {
    result.push(node.moduleSpecifier.getText().replace(/^['"]|['"]$/g, ""));
    const clause = node.importClause;
    if (clause?.name) result.push(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) result.push(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings))
      for (const element of bindings.elements)
        result.push((element.name ?? element.propertyName).text);
  }
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  )
    if (node.name) result.unshift(node.name.text);
  if (ts.isVariableStatement(node))
    for (const declaration of node.declarationList.declarations)
      if (ts.isIdentifier(declaration.name)) result.push(declaration.name.text);
  return [...new Set(result)];
}
function importPath(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    return node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : undefined;
  return undefined;
}
async function resolveDependency(
  root: string,
  from: string,
  specifier: string,
): Promise<string | undefined> {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(root, from, "..");
  const candidate = resolve(base, specifier);
  const candidateExt = extname(candidate).toLowerCase();
  const mapped =
    candidateExt === ".js" || candidateExt === ".jsx"
      ? [
          candidate.slice(0, -candidateExt.length) + ".ts",
          candidate.slice(0, -candidateExt.length) + ".tsx",
        ]
      : candidateExt === ".mjs"
        ? [candidate.slice(0, -4) + ".mts"]
        : [];
  const options = [
    candidate,
    ...mapped,
    ...extensions.map((extension) => `${candidate}${extension}`),
    ...extensions.map((extension) => resolve(candidate, `index${extension}`)),
  ];
  for (const option of options) {
    const rel = relative(root, option);
    if (!rel || rel.startsWith("..")) return undefined;
    if (!extensions.includes(extname(option).toLowerCase())) continue;
    try {
      await noSymlink(root, rel);
      const canonical = await realpath(option);
      if (contained(root, canonical) && (await lstat(option)).isFile()) return rel;
    } catch {}
  }
  return undefined;
}
function makeBlocks(
  root: string,
  path: string,
  text: string,
  query: string,
): {
  blocks: StructureBlock[];
  dependencies: string[];
  unresolvedDependencies: string[];
  syntaxErrors: number;
} {
  const extension = extname(path).toLowerCase();
  const kind = [".ts", ".mts", ".cts"].includes(extension)
    ? ts.ScriptKind.TS
    : extension === ".tsx"
      ? ts.ScriptKind.TSX
      : extension === ".jsx"
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.JS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const dependencies: string[] = [];
  const unresolvedDependencies: string[] = [];
  const blocks: StructureBlock[] = [];
  const terms = [...new Set(query.toLowerCase().match(/[a-z_$][\w$]*/g) ?? [])].slice(0, 256);
  for (const statement of source.statements) {
    const specifier = importPath(statement);
    const dependency = specifier?.startsWith(".") ? specifier : undefined;
    if (dependency) dependencies.push(dependency);
    else if (specifier) unresolvedDependencies.push(specifier);
    let start = statement.getFullStart();
    while (start < statement.getStart(source) && /\s/.test(text[start]!)) start++;
    const textBlock = text.slice(start, statement.getEnd());
    const inspectDynamic = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      ) {
        const argument = node.arguments[0];
        unresolvedDependencies.push(
          argument && ts.isStringLiteralLike(argument) ? argument.text : "<dynamic dependency>",
        );
      }
      ts.forEachChild(node, inspectDynamic);
    };
    inspectDynamic(statement);
    const symbols = names(statement);
    const score = terms.reduce(
      (total, term) =>
        total +
        (symbols.some((symbol) => symbol.toLowerCase() === term) ? 100 : 0) +
        (textBlock.toLowerCase().includes(term) ? 2 : 0),
      0,
    );
    const exactMatch = terms.some((term) =>
      symbols.some((symbol) => symbol.toLowerCase() === term),
    );
    blocks.push({
      path,
      startLine: lineAt(text, start),
      endLine: lineAt(text, statement.getEnd()),
      kind: ts.isImportDeclaration(statement) ? "import" : "declaration",
      ...(symbols[0] ? { name: symbols[0] } : {}),
      content: textBlock,
      sha256: digest(textBlock),
      symbols,
      dependencies: dependency ? [dependency] : [],
      score,
      exactMatch,
    });
  }
  const diagnostics =
    (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ??
    [];
  return {
    blocks,
    dependencies: [...new Set(dependencies)],
    unresolvedDependencies: [...new Set(unresolvedDependencies)],
    syntaxErrors: diagnostics.length,
  };
}

export async function collectStructure(
  rootInput: string,
  input: StructureInput,
  signal?: AbortSignal,
): Promise<StructureResult> {
  if (
    !input ||
    typeof input.query !== "string" ||
    input.query.length > 16384 ||
    !Array.isArray(input.paths) ||
    input.paths.length === 0 ||
    input.paths.length > 16 ||
    input.paths.some((path) => typeof path !== "string" || path.length > 512)
  )
    throw new Error("invalid structure input");
  const maxBytes = input.maxBytes ?? DEFAULT_OUTPUT_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_OUTPUT_BYTES)
    throw new Error("invalid output budget");
  const root = await realpath(resolve(rootInput));
  const queue = [...input.paths];
  const seen = new Set<string>();
  const records = new Map<
    string,
    {
      text: string;
      bytes: number;
      blocks: StructureBlock[];
      dependencies: string[];
      unresolvedDependencies: string[];
      digest: string;
      syntaxErrors: number;
    }
  >();
  const skipped: Array<{ path: string; reason: string }> = [];
  let totalBytes = 0;
  let graphEdges = 0;
  while (queue.length && records.size < MAX_FILES) {
    if (signal?.aborted) throw new Error("source preparation aborted");
    const requested = queue.shift()!;
    let rel: string;
    try {
      rel = safeRelative(root, requested);
    } catch (error) {
      skipped.push({
        path: requested,
        reason: error instanceof Error ? error.message : "invalid path",
      });
      continue;
    }
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (secret.test(rel) || !extensions.includes(extname(rel).toLowerCase())) {
      skipped.push({
        path: rel,
        reason: secret.test(rel) ? "sensitive path" : "unsupported source",
      });
      continue;
    }
    try {
      const loaded = await readSafe(root, rel);
      if (totalBytes + loaded.bytes > MAX_TOTAL_BYTES) {
        skipped.push({ path: rel, reason: "total source limit" });
        continue;
      }
      const parsed = makeBlocks(root, rel, loaded.text, input.query);
      const resolvedDependencies: Array<{ specifier: string; path?: string }> = [];
      for (const specifier of parsed.dependencies) {
        if (signal?.aborted) throw new Error("source preparation aborted");
        if (graphEdges++ >= MAX_GRAPH_EDGES) resolvedDependencies.push({ specifier });
        else {
          const path = await resolveDependency(root, rel, specifier);
          resolvedDependencies.push({ specifier, ...(path ? { path } : {}) });
        }
      }
      const dependencies = resolvedDependencies.flatMap((item) => (item.path ? [item.path] : []));
      const unresolvedDependencies = [
        ...parsed.unresolvedDependencies,
        ...resolvedDependencies.flatMap((item) => (item.path ? [] : [item.specifier])),
      ];
      records.set(rel, {
        text: loaded.text,
        bytes: loaded.bytes,
        blocks: parsed.blocks,
        dependencies,
        unresolvedDependencies: [...new Set(unresolvedDependencies)],
        digest: digest(loaded.text),
        syntaxErrors: parsed.syntaxErrors,
      });
      totalBytes += loaded.bytes;
      for (const dependency of records.get(rel)!.dependencies)
        if (!seen.has(dependency)) queue.push(dependency);
    } catch (error) {
      if (signal?.aborted) throw new Error("source preparation aborted");
      const message = error instanceof Error ? error.message : "source error";
      const known = [
        "symbolic links are not allowed",
        "path is outside root",
        "path moved outside root",
        "file changed before read",
        "file changed during read",
        "file exceeds limit",
        "short read",
      ];
      skipped.push({
        path: rel,
        reason: known.includes(message) ? message : "source cannot be read safely",
      });
    }
  }
  if (queue.length) skipped.push(...queue.map((path) => ({ path, reason: "file limit" })));
  const allBlocks = [...records.values()]
    .flatMap((record) => record.blocks)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine);
  const selected: StructureBlock[] = [];
  const recoveryRefs: StructureResult["recoveryRefs"] = [];
  let used = 0;
  for (const block of allBlocks) {
    const bytes = Buffer.byteLength(block.content);
    if (used + bytes <= maxBytes && selected.length < MAX_BLOCKS) {
      selected.push(block);
      used += bytes;
    } else
      recoveryRefs.push({
        path: block.path,
        startLine: block.startLine,
        endLine: block.endLine,
        sha256: block.sha256,
        score: block.score,
        reason: "output_budget",
      });
  }
  const sourceSummary = [...records.entries()]
    .map(([path, record]) => ({
      path,
      sha256: record.digest,
      bytes: record.bytes,
      dependencies: record.dependencies.slice(0, MAX_METADATA_ITEMS),
      unresolvedDependencies: record.unresolvedDependencies.slice(0, MAX_METADATA_ITEMS),
      dependencyRecordsOmitted:
        Math.max(0, record.dependencies.length - MAX_METADATA_ITEMS) +
        Math.max(0, record.unresolvedDependencies.length - MAX_METADATA_ITEMS),
      blocks: record.blocks.length,
      syntaxErrors: record.syntaxErrors,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const omittedRecovery = Math.max(0, recoveryRefs.length - MAX_METADATA_ITEMS);
  const boundedRecovery = recoveryRefs.slice(0, MAX_METADATA_ITEMS);
  const boundedSkipped = skipped.slice(0, MAX_METADATA_ITEMS);
  const snapshotDigest = digest(
    JSON.stringify({ sources: sourceSummary, skipped, unscanned: queue }),
  );
  const syntaxIncomplete = sourceSummary.some((source) => source.syntaxErrors > 0);
  const unresolvedDependencies = [...records.values()].reduce(
    (total, record) => total + record.unresolvedDependencies.length,
    0,
  );
  const skippedRecordsOmitted = Math.max(0, skipped.length - boundedSkipped.length);
  const result: StructureResult = {
    root: "pinned",
    query: input.query,
    snapshot: snapshotDigest,
    sources: sourceSummary,
    selected,
    recoveryRefs: boundedRecovery,
    skipped: boundedSkipped,
    coverage: {
      requestedFiles: input.paths.length,
      scannedFiles: records.size,
      returnedBlocks: selected.length,
      omittedBlocks: recoveryRefs.length,
      unscannedFiles: queue.length,
      skippedFiles: skipped.length,
      skippedRecordsOmitted,
      unresolvedDependencies,
      recoveryRefsOmitted: omittedRecovery,
      sourceRecordsOmitted: 0,
    },
    incomplete:
      syntaxIncomplete ||
      unresolvedDependencies > 0 ||
      recoveryRefs.length > 0 ||
      skipped.length > 0 ||
      queue.length > 0,
  };
  const excessive = () => Buffer.byteLength(JSON.stringify(result)) > 65536;
  while (excessive() && result.selected.length) {
    result.selected.pop();
    result.coverage.returnedBlocks--;
    result.coverage.omittedBlocks++;
    result.coverage.recoveryRefsOmitted++;
    result.incomplete = true;
  }
  while (excessive() && result.sources.length) {
    result.sources.pop();
    result.coverage.sourceRecordsOmitted++;
    result.incomplete = true;
  }
  if (excessive()) throw new Error("structure output exceeds limit");
  return result;
}

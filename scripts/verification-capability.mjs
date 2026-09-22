import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { JevClient, JevError } from "../dist/core/index.js";
import { buildEvidence } from "./verification-server.mjs";

const [fixturesPath, outputPath] = process.argv.slice(2);
if (!fixturesPath || !outputPath) throw new Error("Frozen fixtures and new output required");
const fixtures = resolve(fixturesPath);
const output = resolve(outputPath);
await mkdir(output);
const client = new JevClient();
const rows = [];
for (let repeat = 1; repeat <= 2; repeat += 1) {
  for (const level of ["low", "medium", "high"]) {
    const metadata = JSON.parse(await readFile(join(fixtures, level, "metadata.json"), "utf8"));
    for (const variant of repeat === 1 ? ["candidate", "reference"] : ["reference", "candidate"]) {
      const root = join(fixtures, level, variant);
      const evidence = await buildEvidence(root, true);
      const expected = Object.fromEntries(
        metadata.claims.flatMap((claim) => {
          const value = claim[variant === "candidate" ? "expectedCandidate" : "expectedReference"];
          if (typeof value !== "boolean") throw new Error("Invalid expected label");
          return [
            [claim.id, value],
            ["neg-" + claim.id, !value],
          ];
        }),
      );
      const row = {
        level,
        variant,
        repeat,
        expected,
        provenance: evidence.provenance,
        stateBytes: evidence.stateBytes,
      };
      try {
        row.result = await client.evaluate(evidence.input);
        row.verdicts = Object.fromEntries(
          Object.entries(expected).map(([id, expectedValue]) => {
            const answer = row.result.answers[id];
            if (answer?.type !== "noul") throw new Error("Unexpected answer type");
            const decisive = answer.noul >= 0.8 ? true : answer.noul <= 0.2 ? false : null;
            return [
              id,
              {
                probability: answer.noul,
                decisive,
                matches: decisive === expectedValue,
                falseApproval: !id.startsWith("neg-") && !expectedValue && decisive === true,
              },
            ];
          }),
        );
      } catch (error) {
        row.error = error instanceof JevError ? error.code : "measurement_error";
      }
      rows.push(row);
      await writeFile(
        join(output, "report.json"),
        JSON.stringify(
          { status: "running", repetitions: 2, threshold: [0.2, 0.8], rows },
          null,
          2,
        ) + "\n",
      );
      process.stdout.write(
        JSON.stringify({ level, variant, repeat, error: row.error ?? null }) + "\n",
      );
    }
  }
}
const errorCount = rows.filter((row) => row.error).length;
await writeFile(
  join(output, "report.json"),
  JSON.stringify(
    {
      status: errorCount ? "completed_with_errors" : "completed",
      errorCount,
      repetitions: 2,
      threshold: [0.2, 0.8],
      rows,
    },
    null,
    2,
  ) + "\n",
);

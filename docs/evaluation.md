# Evaluation

The acceptance suite separates protocol and product-contract checks from live model evaluation. Offline checks validate the authored synthetic fixture, request accounting, metric helpers, CLI behavior, and MCP behavior against an explicit local HTTP stand-in. They do not run inference and therefore report quality as `not_run`; they never convert fixture labels into model accuracy.

Run the offline harness with:

```sh
npx tsx scripts/evaluate.ts
```

The accounting report includes serialized evaluation requests and full MCP tool-call envelopes in bytes and `cl100k_base` token counts. The tokenizer is a named proxy for context accounting, not Jev provider billing. Tool definitions, MCP framing, retries, and the agent conversation are separate overhead and are not silently folded into provider usage.

Run the MCP acceptance tests with:

```sh
node --import tsx --test test/acceptance/mcp-contract.test.ts
```

The test launches an independent stdio process using the official MCP SDK client and server transports. The process injects a loopback HTTP stand-in into `JevClient`, captures and checks the exact outbound body, validates stable tool registration, checks malformed and HTTP error handling, ensures secrets and provider bodies do not leak, and exercises traversal, symlink, missing-file, and incomplete-coverage behavior.

Run the CLI acceptance tests with:

```sh
node --import tsx --test test/acceptance/cli-contract.test.ts
```

They invoke the compiled production CLI for help, version, stdin, missing-credential, malformed-input, and bounded JSON error behavior.

Live evaluation is opt-in and requires `TYPESAFE_API_KEY` or `TYPESAFE_API_KEY_FILE`:

```sh
npx tsx scripts/evaluate.ts --fixture fixtures/evaluation.json --live
```

Add `--context-live` to run the synthetic repository context case as well. It reports selected-source precision and recall against the authored expected file, provider usage/coverage, output bytes, and the raw source-read byte baseline. These are context-selection metrics and must not be described as whole-agent savings.

The live harness uses only synthetic authored states. For Noul answers it classifies probabilities at `<=0.2` false and `>=0.8` true, with an abstention band between them. Choice answers abstain below confidence `0.8`; score answers are recorded but do not become binary correctness labels. Each case reports latency, exit status, provider usage, answer confidence, and errors. Confusion-matrix helpers are tested independently and calculate precision and recall from true/false positives and negatives while reporting abstentions separately.

The fixture is an authored smoke corpus, not a held-out benchmark. A real quality study requires independently adjudicated data, a deterministic baseline, a no-Jev agent arm, repeated paired trajectories, confidence intervals, provider usage, context bytes/tokens, MCP and tool-schema overhead, latency distributions, and task-success measurements. This repository does not claim end-to-end token savings from these tests alone.

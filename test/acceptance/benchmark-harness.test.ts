import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);

test("benchmark isolates ambient credentials and rejects incomplete JSONL accounting", async () => {
  const script = `
import importlib.util, json, os, pathlib, tempfile
spec = importlib.util.spec_from_file_location("benchmark", "scripts/complexity-benchmark.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
os.environ["AI_GATEWAY_API_KEY"] = "synthetic-private-value"
os.environ["TYPESAFE_API_KEY"] = "synthetic-private-value"
os.environ["UNRELATED_ACCESS_TOKEN"] = "synthetic-private-value"
environment = module.runtime_environment()
assert "AI_GATEWAY_API_KEY" not in environment
assert "TYPESAFE_API_KEY" not in environment
assert "UNRELATED_ACCESS_TOKEN" not in environment
assert environment.get("PATH") == os.environ.get("PATH")
with tempfile.TemporaryDirectory() as directory:
    path = pathlib.Path(directory) / "events.jsonl"
    path.write_text('{"type":"turn.completed","usage":{"input_tokens":5}}\\n{broken\\n[]\\n')
    rows, errors = module.read_events(path)
    assert len(rows) == 1
    assert len(errors) == 2
    assert errors[0]["line"] == 2
    assert errors[1]["line"] == 3
    assert module.sum_field([], "input_tokens") is None
print(json.dumps({"credentialIsolation": True, "invalidRecords": len(errors)}))
`;
  const result = await execute(
    process.platform === "win32" ? "python" : "python3",
    ["-c", script],
    { cwd: process.cwd() },
  );
  assert.deepEqual(JSON.parse(result.stdout), { credentialIsolation: true, invalidRecords: 2 });
});

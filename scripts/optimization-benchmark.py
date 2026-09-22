import argparse
import concurrent.futures
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import threading
import time

REPO = Path(__file__).resolve().parent.parent
ARMS = ("native", "prepared", "jev")
LEVELS = ("low", "medium", "high")
LIMITS = {"low": 360, "medium": 600, "high": 900}


def hashes(directory):
    return {str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(directory.rglob("*")) if path.is_file() and "node_modules" not in path.parts}


def runtime_environment():
    allowed = ("PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "CODEX_HOME")
    return {name: os.environ[name] for name in allowed if name in os.environ}


def read_events(path):
    events = []
    errors = []
    if path.exists():
        for number, line in enumerate(path.read_text().splitlines(), 1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError("JSONL record must be an object")
                events.append(value)
            except (json.JSONDecodeError, ValueError):
                errors.append({"file": path.name, "line": number})
    return events, errors


def sum_field(rows, name):
    values = [row.get(name) for row in rows]
    if not values or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 for value in values):
        return None
    return sum(values)


def usage_records_valid(rows):
    required = ("input_tokens", "cached_input_tokens", "output_tokens")
    if not rows:
        return False
    for row in rows:
        if any(isinstance(row.get(name), bool) or not isinstance(row.get(name), (int, float)) or not math.isfinite(row.get(name)) or row.get(name) < 0 for name in required):
            return False
        if row["cached_input_tokens"] > row["input_tokens"]:
            return False
    return True


def provider_usage_record_valid(row):
    for name in ("input_tokens", "output_tokens"):
        value = row.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            return False
    return True


def grade(node, checks, workspace):
    environment = runtime_environment()
    environment["BENCH_WORKSPACE"] = str(workspace)
    try:
        result = subprocess.run([node, "--test", str(checks / "acceptance.test.mjs")], capture_output=True,
                                text=True, env=environment, timeout=60)
    except subprocess.TimeoutExpired:
        return {"exitCode": None, "counts": {}, "passed": False, "output": "Acceptance grading timed out after 60 seconds"}
    counts = {}
    for label in ("tests", "pass", "fail", "skipped", "cancelled"):
        matches = re.findall(r"^# " + label + r" (\d+)$", result.stdout, re.M)
        counts[label] = int(matches[-1]) if matches else None
    return {"exitCode": result.returncode, "counts": counts,
            "passed": result.returncode == 0 and bool(counts.get("tests")) and counts.get("tests") == counts.get("pass") and counts.get("fail") == 0 and counts.get("skipped") == 0 and counts.get("cancelled") == 0,
            "output": result.stdout + result.stderr}


def public_test(node, workspace):
    try:
        result = subprocess.run([node, "--test", "test/public.test.mjs"], cwd=workspace,
                                capture_output=True, text=True, env=runtime_environment(), timeout=60)
    except subprocess.TimeoutExpired:
        return {"exitCode": None, "passed": False, "output": "Public tests timed out after 60 seconds"}
    return {"exitCode": result.returncode, "passed": result.returncode == 0,
            "output": result.stdout + result.stderr}


def make_plan(repetitions, levels):
    plan = []
    for repeat in range(repetitions):
        for level_index, level in enumerate(levels):
            for variant_index, variant in enumerate(("seed", "reference")):
                offset = (repeat + level_index + variant_index) % len(ARMS)
                arms = ARMS[offset:] + ARMS[:offset]
                plan.extend({"level": level, "variant": variant, "arm": arm, "repeat": repeat + 1}
                            for arm in arms)
    for index, spec in enumerate(plan, 1):
        spec["name"] = "trial-" + str(index).zfill(2)
    return plan


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="gpt-6-astra")
    parser.add_argument("--effort", default="xhigh")
    parser.add_argument("--key-file")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--tasks", nargs="+", choices=LEVELS, default=list(LEVELS))
    parser.add_argument("--repetitions", type=int, default=2)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    if args.run and args.prepare_only:
        parser.error("Choose --run or --prepare-only")
    if not 1 <= args.repetitions <= 2 or not 1 <= args.workers <= 2:
        parser.error("Repetitions must be 1-2 and workers must be 1-2")
    if args.run and os.name != "posix":
        parser.error("Live benchmark process isolation requires macOS or Linux")
    if args.run and (not args.key_file or not Path(args.key_file).is_file()):
        parser.error("Live mode requires an existing provider key file")
    if args.run:
        status = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all"], cwd=REPO,
                                capture_output=True, text=True, check=True)
        if status.stdout.strip():
            parser.error("Live mode requires a clean frozen git worktree")
    output = Path(args.output).resolve()
    if output.exists():
        parser.error("Output directory must be new")
    output.mkdir(parents=True)
    node = shutil.which("node")
    if not node:
        parser.error("Node is required")
    codex = shutil.which("codex")
    if args.run and not codex:
        parser.error("Codex CLI is required in live mode")
    snapshot = output / "frozen"
    shutil.copytree(REPO / "bench/optimization", snapshot)
    preflight = {}
    for level in args.tasks:
        checks = snapshot / level / "checks"
        level_root = snapshot / level
        outcomes = {}
        for variant in ("seed", "reference"):
            workspace = level_root / variant
            shutil.copy2(level_root / "contracts.json", workspace / "contracts.json")
            outcome = grade(node, checks, workspace)
            public = public_test(node, workspace)
            (output / (level + "-" + variant + ".tap")).write_text(outcome.pop("output"))
            outcomes[variant] = {"acceptance": outcome, "public": public}
        preflight[level] = outcomes
        if outcomes["seed"]["acceptance"]["passed"] or not outcomes["reference"]["acceptance"]["passed"]:
            (output / "preflight.json").write_text(json.dumps(preflight, indent=2) + "\n")
            raise RuntimeError("Optimization fixture gate failed for " + level)
        if not outcomes["reference"]["public"]["passed"]:
            (output / "preflight.json").write_text(json.dumps(preflight, indent=2) + "\n")
            raise RuntimeError("Optimization public tests failed for " + level)
    plan = make_plan(args.repetitions, args.tasks)
    record = {"version": 1, "status": "running" if args.run else "preflight", "model": args.model,
              "effort": args.effort, "arms": list(ARMS), "runnerHash": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "node": subprocess.check_output([node, "--version"], text=True).strip(),
              "codex": subprocess.check_output([codex, "--version"], text=True).strip() if codex else None,
              "productCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
              "productSourceHashes": hashes(REPO / "src"), "productBuildHashes": hashes(REPO / "dist"),
              "measurementServerHash": hashlib.sha256((REPO / "scripts/optimization-server.mjs").read_bytes()).hexdigest(),
              "fixtureHashes": hashes(snapshot), "plan": plan, "limitsSeconds": LIMITS,
              "preflight": preflight, "workers": args.workers,
              "interpretation": "Three-arm optimization study; native, prepared, and Jev-assisted preparation are descriptive comparisons with no automatic savings or quality approval.",
              "trials": []}
    (output / "protocol.json").write_text(json.dumps(record, indent=2) + "\n")
    if not args.run:
        print(json.dumps({"preflight": preflight, "plannedTrials": len(plan)}))
        return
    lock = threading.Lock()
    active = set()
    stopping = threading.Event()

    def force_stop_children():
        with lock:
            processes = list(active)
        for pid in processes:
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def stop_children(signum, frame):
        stopping.set()
        with lock:
            processes = list(active)
        for pid in processes:
            try:
                os.killpg(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        timer = threading.Timer(8, force_stop_children)
        timer.daemon = True
        timer.start()

    signal.signal(signal.SIGTERM, stop_children)
    signal.signal(signal.SIGINT, stop_children)

    def record_failure(spec, error, status="failed"):
        trial_path = output / "trials" / spec["name"]
        events, event_errors = read_events(trial_path / "events.jsonl")
        provider_events, provider_errors = read_events(trial_path / "optimization.jsonl")
        usage = [event["usage"] for event in events if event.get("type") == "turn.completed" and "usage" in event]
        provider_calls = [event for event in provider_events if event.get("status") in ("provider_success", "provider_error")]
        row = {**spec, "status": status, "error": str(error), "primaryAcceptancePass": None,
               "protocolCompliant": False, "telemetryValid": False, "timedOut": status == "timed_out",
               "usageAvailable": usage_records_valid(usage), "providerUsageComplete": False, "contractUnchanged": False,
               "mainUsage": usage, "inputTokens": sum_field(usage, "input_tokens"),
               "cachedInputTokens": sum_field(usage, "cached_input_tokens"), "outputTokens": sum_field(usage, "output_tokens"),
               "providerCalls": provider_calls, "sourceChanges": None,
               "errors": [{"message": str(error)}], "telemetryParseErrors": event_errors + provider_errors}
        with lock:
            record["trials"].append(row)
            (output / "report.tmp").write_text(json.dumps(record, indent=2) + "\n")
            (output / "report.tmp").replace(output / "report.json")
        return row

    def execute_trial(spec):
        if stopping.is_set():
            return record_failure(spec, "cancelled before start", "cancelled")
        trial = output / "trials" / spec["name"]
        workspace = trial / "workspace"
        shutil.copytree(snapshot / spec["level"] / spec["variant"], workspace)
        initial_source = {"src/" + path: digest for path, digest in hashes(workspace / "src").items()}
        telemetry = trial / "optimization.jsonl"
        for required in ("task.txt", "contracts.json"):
            if not (workspace / required).is_file():
                return record_failure(spec, required + " is missing")
        prompt = (workspace / "task.txt").read_text()
        prompt += "\nThe implementation may already satisfy every requirement. The public contracts are in contracts.json. Work only in this workspace. Preserve compliant source, the public API, and behavior outside demonstrated defects. Keep source in English without comments, run public tests, and add focused regression tests where useful. Do not read parent directories, external checks, user configuration, credentials, or environment variables. Do not install dependencies, contact other agents, or use network except the configured MCP.\n"
        command = [codex, "exec", "--ephemeral", "--ignore-user-config", "--sandbox", "workspace-write",
                   "--skip-git-repo-check", "--json", "--color", "never", "--model", args.model,
                   "-c", "model_reasoning_effort=" + json.dumps(args.effort), "-C", str(workspace)]
        if spec["arm"] != "native":
            mode = "local" if spec["arm"] == "prepared" else "jev"
            prompt += ("\nBefore editing or broad source reading, call jev_prepare with query="
                       "'Select existing source evidence relevant to each public contract for this task', "
                       "paths=['src/index.mjs'], and contractPath='contracts.json'. The MCP wrapper fixes preparation mode to "
                       + mode + ". Treat its result as advisory evidence selection only; do not accept or invent claims, tests, or proofs. "
                       "Use the exact source evidence without automatically reading it twice; inspect further whenever source is missing, stale, or insufficient. Run tests and finish independently. A receipt may be reused only while its evidence remains available to you.\n")
            config = {
                "mcp_servers.jev_optimization.command": json.dumps(node),
                "mcp_servers.jev_optimization.args": json.dumps([str(REPO / "scripts/optimization-server.mjs"), str(workspace), str(telemetry), mode]),
                "mcp_servers.jev_optimization.env": "{ JEV_PROVIDER = \"vercel\", AI_GATEWAY_API_KEY_FILE = " + json.dumps(str(Path(args.key_file).resolve())) + " }",
            }
            for key, value in config.items():
                command.extend(["-c", key + "=" + value])
        command.append("-")
        (trial / "prompt.txt").write_text(prompt)
        started = time.monotonic()
        timed_out = False
        with (trial / "events.jsonl").open("w") as log, (trial / "stderr.txt").open("w") as errors:
            child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=log, stderr=errors, text=True,
                                     start_new_session=True, env=runtime_environment())
            with lock:
                active.add(child.pid)
            try:
                child.communicate(prompt, timeout=LIMITS[spec["level"]])
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            finally:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                with lock:
                    active.discard(child.pid)
        elapsed = round(time.monotonic() - started, 3)
        events, stream_errors = read_events(trial / "events.jsonl")
        items = [event["item"] for event in events if event.get("type") == "item.completed" and "item" in event]
        usage = [event["usage"] for event in events if event.get("type") == "turn.completed" and "usage" in event]
        provider_events, provider_errors = read_events(telemetry)
        prepare_events = [event for event in provider_events if event.get("status") in ("prepare_success", "prepare_error")]
        calls = [event for event in provider_events if event.get("status") in ("provider_success", "provider_error")]
        prepare_started = sum(event.get("status") == "prepare_started" for event in provider_events)
        prepare_successes = [event for event in provider_events if event.get("status") == "prepare_success"]
        provider_started = sum(event.get("status") == "provider_started" for event in provider_events)
        server_started = any(event.get("status") == "server_started" for event in provider_events)
        telemetry_valid = (not stream_errors and not provider_errors and (spec["arm"] == "native" or server_started) and
                           prepare_started == len(prepare_events) and provider_started == len(calls) and
                           not any(event.get("status") == "prepare_error" for event in provider_events))
        assessment = grade(node, snapshot / spec["level"] / "checks", workspace)
        (trial / "acceptance.tap").write_text(assessment.pop("output"))
        prefix = spec["level"] + "/" + spec["variant"] + "/"
        final_hashes = hashes(workspace)
        initial_full = {path: digest for path, digest in hashes(snapshot / spec["level"] / spec["variant"]).items()}
        changes = [path for path in sorted(set(initial_full) | set(final_hashes)) if initial_full.get(path) != final_hashes.get(path)]
        starts = [event for event in provider_events if event.get("status") == "prepare_started"]
        provenance = starts[0].get("provenance", []) if starts else []
        provenance_hashes = {entry.get("path"): entry.get("sha256") for entry in provenance if isinstance(entry, dict)}
        verified_initial_source = bool(provenance_hashes) and set(provenance_hashes) == set(initial_source) and all(digest == initial_source[path] for path, digest in provenance_hashes.items())
        provider_usage_complete = (spec["arm"] == "native" or (telemetry_valid and bool(prepare_successes) and
                                  (not calls or all(event.get("status") == "provider_success" and provider_usage_record_valid(event.get("usage", {})) for event in calls))))
        row = {**spec, "elapsedSeconds": elapsed, "agentExitCode": child.returncode, "timedOut": timed_out,
               "acceptance": assessment, "mainUsage": usage, "usageAvailable": usage_records_valid(usage),
               "telemetryValid": telemetry_valid, "telemetryParseErrors": stream_errors + provider_errors,
               "providerServerStarted": server_started, "prepareStarted": prepare_started, "providerStarted": provider_started, "prepareSuccesses": len(prepare_successes),
               "providerUsageComplete": provider_usage_complete,
               "verifiedInitialSource": verified_initial_source,
               "initialSourceHashes": initial_source,
               "providerProvenance": provenance,
               "inputTokens": sum_field(usage, "input_tokens"), "cachedInputTokens": sum_field(usage, "cached_input_tokens"),
               "outputTokens": sum_field(usage, "output_tokens"), "completedCommands": sum(item.get("type") == "command_execution" for item in items),
               "mcpCalls": [{"server": item.get("server"), "tool": item.get("tool"), "status": item.get("status")} for item in items if item.get("type") == "mcp_tool_call"],
               "providerCalls": calls, "prepareEvents": prepare_events, "changes": changes,
               "sourceChanges": [path for path in changes if path.startswith("src/")],
               "errors": [event for event in events if event.get("type") in ("error", "turn.failed")]}
        if row["inputTokens"] is not None and row["cachedInputTokens"] is not None:
            row["uncachedInputTokens"] = row["inputTokens"] - row["cachedInputTokens"]
        expected_contract = (snapshot / spec["level"] / spec["variant"] / "contracts.json").read_bytes()
        try:
            row["contractUnchanged"] = ((workspace / "contracts.json").read_bytes() == expected_contract and
                                         (workspace / "task.txt").read_bytes() == (snapshot / spec["level"] / spec["variant"] / "task.txt").read_bytes())
        except FileNotFoundError:
            row["contractUnchanged"] = False
        completed_tools = [item for item in items if item.get("type") == "mcp_tool_call" and item.get("tool") == "jev_prepare" and item.get("status") == "completed"]
        first_prepare = next((index for index, item in enumerate(items) if item.get("type") == "mcp_tool_call" and item.get("tool") == "jev_prepare"), None)
        row["commandsBeforePreparation"] = sum(item.get("type") == "command_execution" for item in items[:first_prepare]) if first_prepare is not None else None
        row["protocolCompliant"] = (spec["arm"] == "native" or (len(completed_tools) >= 1 and len(prepare_successes) >= 1 and row["providerUsageComplete"] and verified_initial_source)) and row["contractUnchanged"]
        with lock:
            record["trials"].append(row)
            (output / "report.tmp").write_text(json.dumps(record, indent=2) + "\n")
            (output / "report.tmp").replace(output / "report.json")
            print(json.dumps({"trial": spec["name"], "passed": assessment["passed"], "seconds": elapsed,
                              "inputTokens": row["inputTokens"], "outputTokens": row["outputTokens"], "prepareCalls": len(calls)}), flush=True)
        return row

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        def safe_execute(spec):
            try:
                return execute_trial(spec)
            except Exception as error:
                return record_failure(spec, error)

        futures = [pool.submit(safe_execute, spec) for spec in plan]
        for future in concurrent.futures.as_completed(futures):
            future.result()
    record["integrity"] = {"productSource": record["productSourceHashes"] == hashes(REPO / "src"),
                           "productBuild": record["productBuildHashes"] == hashes(REPO / "dist"),
                           "frozenFixtures": record["fixtureHashes"] == hashes(snapshot),
                           "runner": record["runnerHash"] == hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                           "measurementServer": record["measurementServerHash"] == hashlib.sha256((REPO / "scripts/optimization-server.mjs").read_bytes()).hexdigest()}
    valid = all(record["integrity"].values())
    record["status"] = "invalid_integrity" if not valid else "interrupted" if stopping.is_set() or len(record["trials"]) != len(plan) else "completed"
    (output / "report.json").write_text(json.dumps(record, indent=2) + "\n")
    if not valid:
        raise RuntimeError("Optimization study integrity failed")


if __name__ == "__main__":
    main()

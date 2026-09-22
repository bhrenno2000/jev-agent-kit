import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import threading
import time

REPO = Path(__file__).resolve().parent.parent
ARMS = ("baseline", "optional", "guided")
LEVELS = ("low", "medium", "high")
LIMITS = {"low": 240, "medium": 480, "high": 900}


def hashes(directory):
    return {str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(directory.rglob("*")) if p.is_file() and "node_modules" not in p.parts}


def runtime_environment():
    allowed = ("PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "CODEX_HOME")
    return {name: os.environ[name] for name in allowed if name in os.environ}


def grade(node, checks, workspace):
    environment = runtime_environment()
    environment["BENCH_WORKSPACE"] = str(workspace)
    try:
        result = subprocess.run([node, "--test", str(checks / "acceptance.test.mjs")],
                                capture_output=True, text=True, env=environment, timeout=45)
    except subprocess.TimeoutExpired:
        return {"exitCode": None, "counts": {}, "passed": False, "output": "Acceptance grading timed out after 45 seconds"}
    counts = {}
    for label in ("tests", "pass", "fail", "skipped", "cancelled"):
        matches = re.findall(r"^# " + label + r" (\d+)$", result.stdout, re.M)
        counts[label] = int(matches[-1]) if matches else None
    return {"exitCode": result.returncode, "counts": counts,
            "passed": result.returncode == 0 and bool(counts.get("tests")) and counts.get("fail") == 0,
            "output": result.stdout + result.stderr}


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
    values = [row[name] for row in rows if isinstance(row.get(name), (int, float))]
    return sum(values) if values else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--effort", required=True)
    parser.add_argument("--key-file")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--tasks", nargs="+", choices=LEVELS, default=list(LEVELS))
    parser.add_argument("--repetitions", type=int, default=2)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    if not 1 <= args.repetitions <= 3 or not 1 <= args.workers <= 2:
        parser.error("Repetitions must be 1-3 and workers must be 1-2")
    if args.run and os.name != "posix":
        parser.error("Live benchmark process isolation currently requires macOS or Linux")
    if args.run and (not args.key_file or not Path(args.key_file).is_file()):
        parser.error("Live mode requires an existing provider key file")
    output = Path(args.output).resolve()
    if output.exists():
        parser.error("Output directory must be new so previous trials cannot be overwritten")
    output.mkdir(parents=True)
    node = shutil.which("node")
    codex = shutil.which("codex")
    if not node or not codex:
        parser.error("Node and Codex CLI are required")
    snapshot = output / "frozen"
    shutil.copytree(REPO / "bench/complexity", snapshot)
    preflight = {}
    for level in args.tasks:
        checks = snapshot / "checks" / level
        seed = snapshot / "seeds" / level
        oracle = output / "oracles" / level
        shutil.copytree(seed, oracle)
        reference = checks / "reference"
        overlay = reference / "src" if (reference / "src").exists() else reference
        for source in overlay.rglob("*.mjs"):
            destination = oracle / "src" / source.relative_to(overlay)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
        bad = grade(node, checks, seed)
        good = grade(node, checks, oracle)
        (output / (level + "-seed.tap")).write_text(bad.pop("output"))
        (output / (level + "-oracle.tap")).write_text(good.pop("output"))
        preflight[level] = {"seed": bad, "oracle": good}
        if bad["passed"] or not good["passed"]:
            (output / "preflight.json").write_text(json.dumps(preflight, indent=2))
            raise RuntimeError("Benchmark oracle gate failed for " + level)
    plan = []
    for repeat in range(args.repetitions):
        for level in args.tasks:
            arms = ("baseline", "optional") if repeat % 2 == 0 else ("optional", "baseline")
            plan.extend({"level": level, "arm": arm, "repeat": repeat + 1} for arm in arms)
    plan.extend({"level": level, "arm": "guided", "repeat": 1} for level in args.tasks)
    record = {"version": 1, "status": "running" if args.run else "preflight", "model": args.model, "effort": args.effort,
              "runnerHash": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "node": subprocess.check_output([node, "--version"], text=True).strip(),
              "codex": subprocess.check_output([codex, "--version"], text=True).strip(),
              "productCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
              "productSourceHashes": hashes(REPO / "src"),
              "productBuildHashes": hashes(REPO / "dist"),
              "measurementServerHash": hashlib.sha256((REPO / "scripts/benchmark-server.mjs").read_bytes()).hexdigest(),
              "fixtureHashes": hashes(snapshot), "plan": plan, "limitsSeconds": LIMITS,
              "preflight": preflight, "workers": args.workers,
              "interpretation": "Exploratory paired trials; no population-level or causal guarantee. Guided arms are explicit-use diagnostics, not the default product policy.",
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

        escalation = threading.Timer(8, force_stop_children)
        escalation.daemon = True
        escalation.start()

    signal.signal(signal.SIGTERM, stop_children)
    signal.signal(signal.SIGINT, stop_children)

    def execute_trial(spec):
        name = "{level}-{arm}-{repeat}".format(**spec)
        if stopping.is_set():
            return {**spec, "name": name, "cancelledBeforeStart": True}
        trial = output / "trials" / name
        workspace = trial / "workspace"
        shutil.copytree(snapshot / "seeds" / spec["level"], workspace)
        (workspace / "task.json").unlink(missing_ok=True)
        telemetry = trial / "jev.jsonl"
        prompt = (workspace / "task.txt").read_text()
        prompt += "\nWork only inside this workspace. Do not read parent directories, external acceptance tests, user configuration, credentials, or environment variables. Do not install dependencies or contact other agents. Use no network except an available Jev MCP. Preserve the public API. Keep all source in English without code comments. Run the public tests and add focused regression tests where necessary. Verify actual source and tests before reporting completion.\n"
        command = [codex, "exec", "--ephemeral", "--ignore-user-config", "--sandbox", "workspace-write",
                   "--skip-git-repo-check", "--json", "--color", "never", "--model", args.model,
                   "-c", "model_reasoning_effort=" + json.dumps(args.effort), "-C", str(workspace)]
        if spec["arm"] != "baseline":
            prompt += "\nJev is an advisory evidence selector. Prefer native tools for exact symbols, small files, and context already read. Preserve normal reasoning, source reads, editing, and tests. Recover omitted evidence when it could affect a conclusion.\n"
            if spec["arm"] == "guided":
                prompt += "\nThis explicit-use diagnostic requires one jev_context call: list candidate source paths, then call jev_context before broad source reading to identify evidence for the task. Make the query specific to the requirements. Afterwards use normal tools to recover context and finish the task. If the MCP fails, record that and continue with native tools.\n"
            else:
                prompt += "\nThe MCP is optional. Use it only when it helps this task; it is correct to skip it.\n"
            config = {
                "mcp_servers.jev_agent_kit.command": json.dumps(node),
                "mcp_servers.jev_agent_kit.args": json.dumps([str(REPO / "scripts/benchmark-server.mjs"), str(workspace), str(telemetry)]),
                "mcp_servers.jev_agent_kit.env": "{ JEV_PROVIDER = \"vercel\", AI_GATEWAY_API_KEY_FILE = " + json.dumps(str(Path(args.key_file).resolve())) + " }",
            }
            for key, value in config.items():
                command.extend(["-c", key + "=" + value])
        command.append("-")
        (trial / "prompt.txt").write_text(prompt)
        started = time.monotonic()
        timed_out = False
        with (trial / "events.jsonl").open("w") as log, (trial / "stderr.txt").open("w") as errors:
            child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=log, stderr=errors,
                                     text=True, start_new_session=True, env=runtime_environment())
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
        usage = [event["usage"] for event in events if event.get("type") == "turn.completed" and "usage" in event]
        items = [event["item"] for event in events if event.get("type") == "item.completed" and "item" in event]
        mcp = [item for item in items if item.get("type") == "mcp_tool_call"]
        provider_events, provider_parse_errors = read_events(telemetry)
        calls = [event for event in provider_events if event.get("status") in ("success", "error")]
        provider_started = any(event.get("status") == "server_started" for event in provider_events)
        requests_started = sum(event.get("status") == "request_started" for event in provider_events)
        telemetry_valid = not stream_errors and not provider_parse_errors and (spec["arm"] == "baseline" or provider_started) and requests_started == len(calls)
        assessment = grade(node, snapshot / "checks" / spec["level"], workspace)
        (trial / "acceptance.tap").write_text(assessment.pop("output"))
        row = {**spec, "name": name, "elapsedSeconds": elapsed, "agentExitCode": child.returncode,
               "timedOut": timed_out, "acceptance": assessment, "mainUsage": usage,
               "usageAvailable": bool(usage),
               "telemetryValid": telemetry_valid,
               "telemetryParseErrors": stream_errors + provider_parse_errors,
               "providerServerStarted": provider_started,
               "providerRequestsStarted": requests_started,
               "protocolCompliant": spec["arm"] != "guided" or requests_started > 0,
               "providerUsageComplete": telemetry_valid and all(call.get("status") == "success" for call in calls), "inputTokens": sum_field(usage, "input_tokens"),
               "cachedInputTokens": sum_field(usage, "cached_input_tokens"),
               "outputTokens": sum_field(usage, "output_tokens"),
               "completedCommands": sum(item.get("type") == "command_execution" for item in items),
               "mcpCalls": [{"server": item.get("server"), "tool": item.get("tool"), "status": item.get("status")} for item in mcp],
               "jevCalls": calls, "mainAgentDollarCost": None,
               "changes": [path for path, value in hashes(workspace).items()
                           if record["fixtureHashes"].get("seeds/" + spec["level"] + "/" + path) != value],
               "finalMessages": [item.get("text") for item in items if item.get("type") == "agent_message"][-1:],
               "errors": [event for event in events if event.get("type") in ("error", "turn.failed")]}
        if row["inputTokens"] is not None and row["cachedInputTokens"] is not None:
            row["uncachedInputTokens"] = row["inputTokens"] - row["cachedInputTokens"]
        with lock:
            record["trials"].append(row)
            temp = output / "report.tmp"
            temp.write_text(json.dumps(record, indent=2) + "\n")
            temp.replace(output / "report.json")
            print(json.dumps({"trial": name, "passed": assessment["passed"], "seconds": elapsed,
                              "inputTokens": row["inputTokens"], "outputTokens": row["outputTokens"],
                              "jevCalls": len(calls)}), flush=True)
        return row

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(execute_trial, spec) for spec in plan]
        for future in concurrent.futures.as_completed(futures):
            try:
                future.result()
            except Exception:
                stop_children(None, None)
                for pending in futures:
                    pending.cancel()
                raise
    record["integrity"] = {
        "productSource": record["productSourceHashes"] == hashes(REPO / "src"),
        "productBuild": record["productBuildHashes"] == hashes(REPO / "dist"),
        "frozenFixtures": record["fixtureHashes"] == hashes(snapshot),
        "runner": record["runnerHash"] == hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "measurementServer": record["measurementServerHash"] == hashlib.sha256((REPO / "scripts/benchmark-server.mjs").read_bytes()).hexdigest(),
    }
    valid_integrity = all(record["integrity"].values())
    record["status"] = "invalid_integrity" if not valid_integrity else "interrupted" if stopping.is_set() or len(record["trials"]) != len(plan) else "completed"
    (output / "report.json").write_text(json.dumps(record, indent=2) + "\n")
    if not valid_integrity:
        raise RuntimeError("Study integrity failed; do not aggregate these trials")


if __name__ == "__main__":
    main()

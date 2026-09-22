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
ARMS = ("baseline", "verified")
LEVELS = ("low", "medium", "high")
LIMITS = {"low": 300, "medium": 480, "high": 720}


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
    shutil.copytree(REPO / "bench/verification", snapshot)
    preflight = {}
    for level in args.tasks:
        checks = snapshot / level / "checks"
        bad = grade(node, checks, snapshot / level / "candidate")
        good = grade(node, checks, snapshot / level / "reference")
        (output / (level + "-candidate.tap")).write_text(bad.pop("output"))
        (output / (level + "-reference.tap")).write_text(good.pop("output"))
        preflight[level] = {"candidate": bad, "reference": good}
        if bad["passed"] or not good["passed"]:
            raise RuntimeError("Verification fixture gate failed for " + level)
        for variant in ("candidate", "reference"):
            public = subprocess.run([node, "--test", "test/public.test.mjs"], cwd=snapshot / level / variant, capture_output=True, text=True, env=runtime_environment(), timeout=30)
            if public.returncode != 0:
                raise RuntimeError("Public fixture tests failed")
    plan = []
    for repeat in range(args.repetitions):
        for level in args.tasks:
            for variant in (("candidate", "reference") if repeat % 2 == 0 else ("reference", "candidate")):
                arms = ("baseline", "verified") if repeat % 2 == 0 else ("verified", "baseline")
                plan.extend({"level": level, "variant": variant, "arm": arm, "repeat": repeat + 1} for arm in arms)
    for index, spec in enumerate(plan, 1):
        spec["name"] = "trial-" + str(index).zfill(2)
    record = {"version": 1, "status": "running" if args.run else "preflight", "model": args.model, "effort": args.effort,
              "runnerHash": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "node": subprocess.check_output([node, "--version"], text=True).strip(),
              "codex": subprocess.check_output([codex, "--version"], text=True).strip(),
              "productCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
              "productSourceHashes": hashes(REPO / "src"),
              "productBuildHashes": hashes(REPO / "dist"),
              "measurementServerHash": hashlib.sha256((REPO / "scripts/verification-server.mjs").read_bytes()).hexdigest(),
              "fixtureHashes": hashes(snapshot), "plan": plan, "limitsSeconds": LIMITS,
              "preflight": preflight, "workers": args.workers,
              "interpretation": "Controlled advisory verification study; defective and clean inputs, paired native and Jev review. No universal accuracy or savings guarantee.",
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
        name = spec["name"]
        if stopping.is_set():
            return {**spec, "name": name, "cancelledBeforeStart": True}
        trial = output / "trials" / name
        workspace = trial / "workspace"
        shutil.copytree(snapshot / spec["level"] / spec["variant"], workspace)
        metadata = json.loads((snapshot / spec["level"] / "metadata.json").read_text())
        contract = {"claims": [{"id": claim["id"], "statement": claim["statement"]} for claim in metadata["claims"]]}
        (workspace / "verification-contract.json").write_text(json.dumps(contract, indent=2) + "\n")
        telemetry = trial / "jev.jsonl"
        prompt = (workspace / "task.txt").read_text()
        prompt += "\nThis is a review task. The implementation may already be correct. Evaluate the four claims in verification-contract.json before editing; preserve compliant source. Fix only demonstrated contract violations, use targeted regression tests, and give a concise final review. Do not edit task.txt or verification-contract.json. Work only inside this workspace. Do not read parent directories, external acceptance tests, user configuration, credentials, or environment variables. Do not install dependencies or contact other agents. Use no network except an available Jev MCP. Preserve the public API. Keep all source in English without code comments. Run the public tests and add focused regression tests where necessary. Verify actual source and tests before reporting completion.\n"
        command = [codex, "exec", "--ephemeral", "--ignore-user-config", "--sandbox", "workspace-write",
                   "--skip-git-repo-check", "--json", "--color", "never", "--model", args.model,
                   "-c", "model_reasoning_effort=" + json.dumps(args.effort), "-C", str(workspace)]
        if spec["arm"] == "verified":
            prompt += "\nBefore editing source, call jev_verify_claims once. It reads all local source and the four claims directly. Treat every judgment as advisory, inspect the actual evidence, and resolve disagreement with reasoning or tests. Do not accept a claim merely because Jev supports it. If the MCP fails, record the failure and continue with native review. No further Jev calls are required.\n"
            config = {
                "mcp_servers.jev_verification.command": json.dumps(node),
                "mcp_servers.jev_verification.args": json.dumps([str(REPO / "scripts/verification-server.mjs"), str(workspace), str(telemetry)]),
                "mcp_servers.jev_verification.env": "{ JEV_PROVIDER = \"vercel\", AI_GATEWAY_API_KEY_FILE = " + json.dumps(str(Path(args.key_file).resolve())) + " }",
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
        assessment = grade(node, snapshot / spec["level"] / "checks", workspace)
        (trial / "acceptance.tap").write_text(assessment.pop("output"))
        row = {**spec, "name": name, "elapsedSeconds": elapsed, "agentExitCode": child.returncode,
               "timedOut": timed_out, "acceptance": assessment, "mainUsage": usage,
               "usageAvailable": bool(usage),
               "telemetryValid": telemetry_valid,
               "telemetryParseErrors": stream_errors + provider_parse_errors,
               "providerServerStarted": provider_started,
               "providerRequestsStarted": requests_started,
               "protocolCompliant": spec["arm"] == "baseline" or (requests_started > 0 and any(item.get("tool") == "jev_verify_claims" for item in mcp)),
               "providerUsageComplete": telemetry_valid and (spec["arm"] == "baseline" or bool(calls)) and all(call.get("status") == "success" for call in calls), "inputTokens": sum_field(usage, "input_tokens"),
               "cachedInputTokens": sum_field(usage, "cached_input_tokens"),
               "outputTokens": sum_field(usage, "output_tokens"),
               "completedCommands": sum(item.get("type") == "command_execution" for item in items),
               "mcpCalls": [{"server": item.get("server"), "tool": item.get("tool"), "status": item.get("status")} for item in mcp],
               "jevCalls": calls, "mainAgentDollarCost": None,
               "changes": [path for path, value in hashes(workspace).items()
                           if record["fixtureHashes"].get(spec["level"] + "/" + spec["variant"] + "/" + path) != value],
               "finalMessages": [item.get("text") for item in items if item.get("type") == "agent_message"][-1:],
               "errors": [event for event in events if event.get("type") in ("error", "turn.failed")]}
        row["contractUnchanged"] = (workspace / "verification-contract.json").read_text() == json.dumps(contract, indent=2) + "\n" and (workspace / "task.txt").read_bytes() == (snapshot / spec["level"] / spec["variant"] / "task.txt").read_bytes()
        starts = [event for event in provider_events if event.get("status") == "request_started"]
        initial = hashes(snapshot / spec["level"] / spec["variant"] / "src")
        expected = {"src/" + path: digest for path, digest in initial.items() if path.endswith(".mjs")}
        row["verifiedInitialSource"] = bool(starts) and {entry["path"]: entry["sha256"] for entry in starts[0].get("provenance", [])} == expected
        row["sourceChanges"] = [path for path in row["changes"] if path.startswith("src/")]
        row["protocolCompliant"] = row["protocolCompliant"] and row["contractUnchanged"] and (spec["arm"] == "baseline" or (row["verifiedInitialSource"] and any(call.get("status") == "success" for call in calls)))
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
    completed_names = {trial["name"] for trial in record["trials"]}
    record["trials"].extend({**spec, "cancelledBeforeStart": True} for spec in plan if spec["name"] not in completed_names)
    record["integrity"] = {
        "productSource": record["productSourceHashes"] == hashes(REPO / "src"),
        "productBuild": record["productBuildHashes"] == hashes(REPO / "dist"),
        "frozenFixtures": record["fixtureHashes"] == hashes(snapshot),
        "runner": record["runnerHash"] == hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "measurementServer": record["measurementServerHash"] == hashlib.sha256((REPO / "scripts/verification-server.mjs").read_bytes()).hexdigest(),
    }
    valid_integrity = all(record["integrity"].values())
    record["status"] = "invalid_integrity" if not valid_integrity else "interrupted" if stopping.is_set() or len(record["trials"]) != len(plan) else "completed"
    (output / "report.json").write_text(json.dumps(record, indent=2) + "\n")
    if not valid_integrity:
        raise RuntimeError("Study integrity failed; do not aggregate these trials")


if __name__ == "__main__":
    main()

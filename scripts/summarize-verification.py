import argparse
import csv
import importlib.util
import json
from pathlib import Path


def load_complexity():
    path = Path(__file__).with_name("summarize-complexity.py")
    spec = importlib.util.spec_from_file_location("complexity_summary", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


complexity = load_complexity()
usage_row = complexity.usage_row


def primary_pass(trial):
    acceptance = trial.get("acceptance") or {}
    return bool(acceptance.get("passed") is True and trial.get("agentExitCode") == 0 and trial.get("timedOut") is False)


def protocol_ok(trial):
    value = trial.get("protocolCompliant")
    return value if isinstance(value, bool) else None


def telemetry_ok(trial):
    value = trial.get("telemetryValid")
    return value if isinstance(value, bool) else None


def source_verified(trial):
    return trial.get("verifiedInitialSource") is True


def contract_unchanged(trial):
    return trial.get("contractUnchanged") is True


def trial_row(plan, trial):
    row = {**plan}
    if trial is None:
        row.update({"status": "missing", "primaryAcceptancePass": None, "protocolCompliant": None, "telemetryValid": None, "timedOut": None, "mainInputTokens": None, "mainCachedInputTokens": None, "mainUncachedInputTokens": None, "mainOutputTokens": None, "mainNominalTokenSum": None, "providerUsageStatus": "unknown", "gatewayBillingStatus": "unknown", "mcpCallCount": None, "evaluationCallCount": None, "httpAttemptCount": None, "sourceVerified": False, "contractUnchanged": False})
        return row
    row.update(usage_row(trial))
    row.update({"status": "complete", "primaryAcceptancePass": primary_pass(trial), "protocolCompliant": protocol_ok(trial), "telemetryValid": telemetry_ok(trial), "timedOut": trial.get("timedOut"), "elapsedSeconds": trial.get("elapsedSeconds"), "sourceVerified": source_verified(trial), "contractUnchanged": contract_unchanged(trial), "sourceChanges": trial.get("sourceChanges") if isinstance(trial.get("sourceChanges"), list) else None, "changedFiles": trial.get("changes") if isinstance(trial.get("changes"), list) else None, "usageAvailable": trial.get("usageAvailable"), "providerUsageComplete": trial.get("providerUsageComplete"), "telemetryParseErrors": trial.get("telemetryParseErrors") or [], "errors": trial.get("errors") or [], "reviewErrors": trial.get("reviewErrors") or []})
    if trial.get("timedOut") or trial.get("agentExitCode") is None or trial.get("errors") or row["telemetryParseErrors"]:
        row["status"] = "failed_or_partial"
    row["qualityOutcome"] = "pass" if row["primaryAcceptancePass"] else "fail" if row["primaryAcceptancePass"] is False else "unknown"
    return row


def pct(before, after):
    if before is None or after is None or before == 0:
        return None
    return (after - before) / before * 100


def pair_rows(rows):
    groups = {}
    for row in rows:
        groups.setdefault((row.get("level"), row.get("variant"), row.get("repeat")), {})[row.get("arm")] = row
    result = []
    for key, arms in sorted(groups.items()):
        baseline, verified = arms.get("baseline"), arms.get("verified")
        item = {"level": key[0], "variant": key[1], "repeat": key[2], "baseline": baseline.get("name") if baseline else None, "verified": verified.get("name") if verified else None, "qualityComparison": "unknown", "eligible": False}
        if baseline and verified:
            if baseline.get("primaryAcceptancePass") is None or verified.get("primaryAcceptancePass") is None:
                item["qualityComparison"] = "unknown"
            elif baseline.get("primaryAcceptancePass") is True and verified.get("primaryAcceptancePass") is True:
                item["qualityComparison"] = "tie"
            elif baseline.get("primaryAcceptancePass") is False and verified.get("primaryAcceptancePass") is True:
                item["qualityComparison"] = "verified_win"
            elif baseline.get("primaryAcceptancePass") is True and verified.get("primaryAcceptancePass") is False:
                item["qualityComparison"] = "verified_loss"
            else:
                item["qualityComparison"] = "both_fail"
            for name in ("mainInputTokens", "mainCachedInputTokens", "mainUncachedInputTokens", "mainOutputTokens", "mainNominalTokenSum"):
                item[name + "DeltaPercent"] = pct(baseline.get(name), verified.get(name))
            main_usage_complete = all(row.get(name) is not None for row in (baseline, verified) for name in ("mainInputTokens", "mainCachedInputTokens", "mainOutputTokens", "mainNominalTokenSum"))
            protocol_complete = all(row.get("primaryAcceptancePass") is True and row.get("timedOut") is False and row.get("protocolCompliant") is True and row.get("telemetryValid") is True and row.get("contractUnchanged") is True and row.get("usageAvailable") is True and not row.get("telemetryParseErrors") and not row.get("errors") and not row.get("reviewErrors") for row in (baseline, verified))
            native_provider_valid = baseline.get("providerUsageStatus") == "not_applicable"
            verified_provider_valid = verified.get("providerUsageStatus") == "complete" and verified.get("evaluationCallCount", 0) > 0 and verified.get("sourceVerified") is True and verified.get("providerUsageComplete") is True
            item["eligible"] = bool(main_usage_complete and protocol_complete and native_provider_valid and verified_provider_valid)
            item["eligibilityReason"] = "complete metrics, source provenance, and unchanged contract" if item["eligible"] else "quality and all outcomes retained; comparison ineligible due to missing metrics, provenance, or contract proof"
        else:
            item["eligibilityReason"] = "missing paired outcome"
        result.append(item)
    return result


def capability_metrics(capability):
    rows = capability.get("rows", []) if isinstance(capability, dict) else []
    expected_true = expected_false = decisive_correct = decisive_wrong = abstain = expected_true_abstain = expected_false_abstain = 0
    tp = tn = fp = fn = 0
    false_approval = false_alarm = 0
    contradictions = []
    by_scope = {}
    for row in rows:
        for claim, expected in (row.get("expected") or {}).items():
            verdict = (row.get("verdicts") or {}).get(claim) or {}
            probability = verdict.get("probability")
            valid_probability = isinstance(probability, (int, float)) and not isinstance(probability, bool) and probability == probability and probability not in (float("inf"), float("-inf")) and 0 <= probability <= 1
            actual = True if valid_probability and probability >= capability.get("threshold", [0.2, 0.8])[1] else False if valid_probability and probability <= capability.get("threshold", [0.2, 0.8])[0] else None
            if expected: expected_true += 1
            else: expected_false += 1
            if actual is None:
                abstain += 1
                if expected: expected_true_abstain += 1
                else: expected_false_abstain += 1
            elif actual == expected: decisive_correct += 1
            else: decisive_wrong += 1
            if expected and actual is True: tp += 1
            elif not expected and actual is False: tn += 1
            elif not expected and actual is True:
                fp += 1
                if row.get("variant") == "candidate" and not claim.startswith("neg-"):
                    false_approval += 1
            elif expected and actual is False:
                fn += 1
                if not claim.startswith("neg-"):
                    false_alarm += 1
            scope = (row.get("level"), row.get("variant"), row.get("repeat"))
            by_scope.setdefault(scope, {})[claim] = actual
    for scope, claims in by_scope.items():
        for claim, actual in list(claims.items()):
            if claim.startswith("neg-"):
                base = claims.get(claim[4:])
                if actual is not None and base is not None and actual == base:
                    contradictions.append({"scope": scope, "claim": claim[4:], "value": actual})
    return {"expectedTrue": expected_true, "expectedFalse": expected_false, "decisiveCorrect": decisive_correct, "decisiveWrong": decisive_wrong, "abstain": abstain, "expectedTrueAbstain": expected_true_abstain, "expectedFalseAbstain": expected_false_abstain, "confusion": {"truePositive": tp, "trueNegative": tn, "falsePositive": fp, "falseNegative": fn, "precision": tp / (tp + fp) if tp + fp else None, "selectiveRecall": tp / (tp + fn) if tp + fn else None, "recallCountingAbstentionsAsMisses": tp / (tp + fn + expected_true_abstain) if tp + fn + expected_true_abstain else None}, "falseApprovalOriginalPositiveClaimOnDefectiveInput": false_approval, "falseAlarmOnCorrectProperty": false_alarm, "positiveInverseContradictions": contradictions, "rows": len(rows)}


def write_csv(path, rows):
    fields = sorted({field for row in rows for field in row})
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--capability", required=True)
    parser.add_argument("--adjudication")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    if output.exists():
        parser.error("Output directory must be new")
    output.mkdir(parents=True)
    report = json.loads(Path(args.report).read_text())
    capability = json.loads(Path(args.capability).read_text())
    plan = report.get("plan", [])
    trials_by_name = {trial.get("name"): trial for trial in report.get("trials", []) if isinstance(trial, dict)}
    rows = [trial_row(item, trials_by_name.get(item.get("name"))) for item in plan]
    unexpected = [trial for trial in report.get("trials", []) if isinstance(trial, dict) and trial.get("name") not in {item.get("name") for item in plan}]
    pairs = pair_rows(rows)
    quality_counts = {"verifiedWin": sum(item["qualityComparison"] == "verified_win" for item in pairs), "verifiedLoss": sum(item["qualityComparison"] == "verified_loss" for item in pairs), "tie": sum(item["qualityComparison"] == "tie" for item in pairs)}
    payload = {"sourceReport": str(Path(args.report).resolve()), "sourceCapability": str(Path(args.capability).resolve()), "studyStatus": report.get("status"), "plannedTrials": len(plan), "reportedTrials": len(report.get("trials", [])), "unexpectedTrials": unexpected, "trials": rows, "pairedComparisons": pairs, "qualityCounts": quality_counts, "capability": capability_metrics(capability), "limitations": ["Small authored replicates do not establish statistical or universal claims.", "Main-agent cost is not reported; provider usage and gateway billing remain separate unknown/cost fields.", "A token delta is descriptive only and cannot prove savings when quality worsens or output rises.", "Reference source changes are recorded as edits and are not automatic failures.", "Eligible pairs require complete main/provider metrics, verified original-source provenance, and contract-unchanged evidence."]}
    if args.adjudication:
        adjudication = json.loads(Path(args.adjudication).read_text())
        filtered = json.loads(json.dumps(capability))
        for row in filtered.get("rows", []):
            excluded = {claim for exclusion in adjudication["excluded"] if row.get("level") == exclusion["level"] and row.get("variant") in exclusion["variants"] and row.get("repeat") in exclusion["repetitions"] for claim in exclusion["claims"]}
            row["expected"] = {key: value for key, value in row.get("expected", {}).items() if key not in excluded}
            row["verdicts"] = {key: value for key, value in row.get("verdicts", {}).items() if key not in excluded}
        payload["postHocSensitivity"] = {"reason": adjudication["reason"], "excluded": adjudication["excluded"], "frozenLabelsPreserved": True, "capability": capability_metrics(filtered)}
    (output / "summary.json").write_text(json.dumps(payload, indent=2, default=str) + "\n")
    write_csv(output / "trials.csv", rows)
    lines = ["# Verification study summary", "", f"Study status: `{payload['studyStatus']}`. Planned outcomes: {payload['plannedTrials']}; reported outcomes: {payload['reportedTrials']}; unexpected outcomes: {len(unexpected)}.", "", "## Quality and protocol", "", f"Primary acceptance verified wins: {quality_counts['verifiedWin']}; losses: {quality_counts['verifiedLoss']}; ties: {quality_counts['tie']}.", "Protocol compliance and telemetry validity remain separate fields per trial; failures, timeouts, review errors, missing calls, and missing usage remain in the output.", "", "## Capability judgments", "", f"Expected true: {payload['capability']['expectedTrue']}; expected false: {payload['capability']['expectedFalse']}; decisive correct: {payload['capability']['decisiveCorrect']}; decisive wrong: {payload['capability']['decisiveWrong']}; abstentions: {payload['capability']['abstain']}.", f"False approvals on defective positive claims: {payload['capability']['falseApprovalOriginalPositiveClaimOnDefectiveInput']}; false alarms on correct properties: {payload['capability']['falseAlarmOnCorrectProperty']}; positive/inverse contradictions: {len(payload['capability']['positiveInverseContradictions'])}.", "", "## Limitations", ""] + [f"- {item}" for item in payload["limitations"]] + ["", "## Files", "", "- `summary.json` contains every planned outcome, pair, and capability metric.", "- `trials.csv` contains one row per planned outcome, including missing outcomes."]
    if payload.get("postHocSensitivity"):
        adjusted = payload["postHocSensitivity"]["capability"]
        lines.extend(["", "## Post hoc label sensitivity", "", payload["postHocSensitivity"]["reason"], "The original frozen-label totals above are retained. The following subset excludes the disclosed ambiguous claims; this was not a preregistered score.", f"Subset judgments: {adjusted['expectedTrue'] + adjusted['expectedFalse']}; decisive label matches: {adjusted['decisiveCorrect']}; decisive disagreements: {adjusted['decisiveWrong']}; abstentions: {adjusted['abstain']}."])
    (output / "summary.md").write_text("\n".join(lines) + "\n")
    print(json.dumps({"output": str(output), "plannedTrials": len(plan), "reportedTrials": len(report.get("trials", [])), "pairs": len(pairs)}))


if __name__ == "__main__":
    main()

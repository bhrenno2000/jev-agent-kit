import argparse
import csv
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and value not in (float("inf"), float("-inf")) and value >= 0 else None


def decimal(value):
    try:
        parsed = Decimal(str(value))
        return parsed if parsed.is_finite() and parsed >= 0 else None
    except (InvalidOperation, TypeError, ValueError):
        return None


def decimal_sum(values):
    total = Decimal("0")
    found = False
    for value in values:
        parsed = decimal(value)
        if parsed is None:
            return None
        total += parsed
        found = True
    return format(total, "f") if found else None


def usage_row(trial):
    turns = trial.get("mainUsage")
    turns = turns if isinstance(turns, list) else []
    required = ("input_tokens", "cached_input_tokens", "output_tokens")
    invalid_turn = any(not isinstance(turn, dict) for turn in turns)
    valid_turns = [turn for turn in turns if isinstance(turn, dict)]
    complete_turns = not invalid_turn and all(all(number(turn.get(key)) is not None for key in required) and turn["cached_input_tokens"] <= turn["input_tokens"] for turn in valid_turns) and bool(valid_turns)
    main_input = sum((turn["input_tokens"] for turn in valid_turns), 0) if complete_turns else None
    cached = sum((turn["cached_input_tokens"] for turn in valid_turns), 0) if complete_turns else None
    output = sum((turn["output_tokens"] for turn in valid_turns), 0) if complete_turns else None
    uncached = main_input - cached if main_input is not None and cached is not None and main_input >= cached else None
    main_nominal = main_input + output if main_input is not None and output is not None else None
    raw_provider = trial.get("jevCalls")
    invalid_provider_container = raw_provider is not None and not isinstance(raw_provider, list)
    raw_provider = raw_provider if isinstance(raw_provider, list) else []
    invalid_provider_record = invalid_provider_container or any(not isinstance(event, dict) or event.get("status") not in ("success", "error") for event in raw_provider)
    provider = [event for event in raw_provider if isinstance(event, dict) and event.get("status") in ("success", "error")]
    successful_provider = [event for event in provider if event.get("status") == "success"]
    provider_usage = [event.get("usage") for event in successful_provider]
    provider_complete = bool(provider) and len(successful_provider) == len(provider) and bool(provider_usage) and all(isinstance(item, dict) and number(item.get("input_tokens")) is not None and number(item.get("output_tokens")) is not None for item in provider_usage)
    provider_input = sum((item["input_tokens"] for item in provider_usage), 0) if provider_complete else None
    provider_output = sum((item["output_tokens"] for item in provider_usage), 0) if provider_complete else None
    gateways = []
    invalid_metadata = False
    for event in successful_provider:
        metadata = event.get("providerMetadata")
        if metadata is None:
            gateways.append(None)
        elif not isinstance(metadata, dict):
            invalid_metadata = True
            gateways.append(None)
        else:
            gateway = metadata.get("gateway")
            if gateway is not None and not isinstance(gateway, dict):
                invalid_metadata = True
            gateways.append(gateway if isinstance(gateway, dict) else None)
    billing_values = [gateway.get("cost") if isinstance(gateway, dict) else None for gateway in gateways] if provider_complete else [None] if provider else []
    reasoning = sum((number(turn.get("reasoning_output_tokens")) or 0 for turn in valid_turns), 0) if valid_turns and all(number(turn.get("reasoning_output_tokens")) is not None for turn in valid_turns) else None
    attempt_values = []
    invalid_attempt_metadata = False
    for event in provider:
        metadata = event.get("meta")
        if metadata is None:
            invalid_attempt_metadata = True
            attempt_values.append(None)
        elif not isinstance(metadata, dict):
            invalid_attempt_metadata = True
            attempt_values.append(None)
        else:
            attempt_values.append(number(metadata.get("attempts")))
    return {
        "mainInputTokens": main_input,
        "mainCachedInputTokens": cached,
        "mainUncachedInputTokens": uncached,
        "mainOutputTokens": output,
        "mainNominalTokenSum": main_nominal,
        "mainReasoningOutputTokens": reasoning,
        "providerInputTokens": provider_input,
        "providerOutputTokens": provider_output,
        "providerUsageStatus": "complete" if provider_complete and not invalid_provider_record else "incomplete" if provider or invalid_provider_record else "not_applicable",
        "reportedGatewayCost": decimal_sum(billing_values),
        "reportedGatewayMarketCost": decimal_sum([gateway.get("marketCost") if isinstance(gateway, dict) else None for gateway in gateways] if provider_complete else [None] if provider else []),
        "gatewayBillingStatus": "complete" if provider_complete and not invalid_metadata and all(isinstance(gateway, dict) and decimal(gateway.get("cost")) is not None for gateway in gateways) else "incomplete" if provider or invalid_provider_record or invalid_metadata else "not_applicable",
        "mcpCallCount": len(trial.get("mcpCalls", [])) if isinstance(trial.get("mcpCalls"), list) else None,
        "evaluationCallCount": len(trial.get("jevCalls", [])) if isinstance(trial.get("jevCalls"), list) else None,
        "httpAttemptCount": sum(attempt_values, 0) if provider and not invalid_attempt_metadata and all(value is not None for value in attempt_values) else None,
    }


def quality(trial):
    acceptance = trial.get("acceptance") or {}
    return bool(acceptance.get("passed") is True and trial.get("agentExitCode") == 0 and trial.get("timedOut") is False)


def complete_usage(trial, row):
    usage_complete = all(number(row.get(key)) is not None for key in ("mainInputTokens", "mainCachedInputTokens", "mainOutputTokens"))
    telemetry = trial.get("telemetryValid") is True and not trial.get("telemetryParseErrors")
    protocol = not (trial.get("arm") == "guided") or trial.get("protocolCompliant") is True
    return bool(usage_complete and telemetry and trial.get("usageAvailable") is True and protocol)


def trial_row(trial):
    row = {"name": trial.get("name"), "level": trial.get("level"), "arm": trial.get("arm"), "repeat": trial.get("repeat"), "elapsedSeconds": trial.get("elapsedSeconds"), "agentExitCode": trial.get("agentExitCode"), "timedOut": trial.get("timedOut"), "primaryAcceptancePass": quality(trial), "qualityPass": quality(trial), "telemetryValid": trial.get("telemetryValid"), "protocolCompliant": trial.get("protocolCompliant"), "providerUsageComplete": trial.get("providerUsageComplete"), "missingTelemetry": bool(trial.get("telemetryParseErrors")) or not trial.get("usageAvailable", False)}
    row.update(usage_row(trial))
    row["validCompleteCorrectUsage"] = bool(row["primaryAcceptancePass"] and complete_usage(trial, row))
    row["guidedDiagnosticOnly"] = row["arm"] == "guided"
    row["optionalInferenceObserved"] = row["arm"] == "optional" and row.get("evaluationCallCount") is not None and row.get("evaluationCallCount") > 0 and row.get("providerUsageStatus") == "complete" and row.get("providerUsageComplete") is True and row.get("telemetryValid") is True
    row["guidedProtocolFailure"] = row["arm"] == "guided" and row.get("protocolCompliant") is False
    row["status"] = "complete" if row["validCompleteCorrectUsage"] else "partial_or_invalid"
    return row


def pct(before, after):
    if before is None or after is None or before == 0:
        return None
    return (after - before) / before * 100


def pairs(rows):
    grouped = {}
    for row in rows:
        if row["arm"] in ("baseline", "optional"):
            grouped.setdefault((row["level"], row["repeat"]), {})[row["arm"]] = row
    comparisons = []
    for (level, repeat), arms in sorted(grouped.items()):
        base = arms.get("baseline")
        optional = arms.get("optional")
        eligible = bool(base and optional and base["validCompleteCorrectUsage"] and optional["validCompleteCorrectUsage"] and optional["optionalInferenceObserved"])
        comparison = {"level": level, "repeat": repeat, "eligible": eligible, "reason": None, "baseline": base["name"] if base else None, "optional": optional["name"] if optional else None, "qualityRegression": bool(base and optional and base["qualityPass"] and not optional["qualityPass"])}
        if base and optional:
            comparison.update({"inputDeltaPercent": pct(base.get("mainInputTokens"), optional.get("mainInputTokens")), "uncachedInputDeltaPercent": pct(base.get("mainUncachedInputTokens"), optional.get("mainUncachedInputTokens")), "outputDeltaPercent": pct(base.get("mainOutputTokens"), optional.get("mainOutputTokens")), "mainNominalTokenDeltaPercent": pct(base.get("mainNominalTokenSum"), optional.get("mainNominalTokenSum")), "numericUsageComparable": base.get("mainNominalTokenSum") is not None and optional.get("mainNominalTokenSum") is not None, "attributionEligible": False, "netCostBenefitVerified": "unknown"})
            comparison["attributionEligible"] = bool(comparison["numericUsageComparable"] and base["validCompleteCorrectUsage"] and optional["validCompleteCorrectUsage"] and optional["optionalInferenceObserved"] and base["qualityPass"] and optional["qualityPass"])
        if not base or not optional:
            comparison["reason"] = "missing paired trial"
        elif not base["validCompleteCorrectUsage"] or not optional["validCompleteCorrectUsage"]:
            comparison["reason"] = "quality, usage, or telemetry incomplete"
        elif not optional["optionalInferenceObserved"]:
            comparison["reason"] = "optional arm made no verified Jev inference call"
        else:
            comparable_usage = comparison["numericUsageComparable"]
            if not comparable_usage:
                comparison["reason"] = "main usage incomplete"
            elif not optional["optionalInferenceObserved"]:
                comparison["reason"] = "registration/adoption observation; optional arm made no verified Jev inference call"
            elif comparison["qualityRegression"]:
                comparison["reason"] = "quality regression"
            else:
                comparison["reason"] = "eligible paired observation; no automatic benefit approval"
        comparisons.append(comparison)
    return comparisons


def write_csv(path, rows):
    fields = sorted({key for row in rows for key in row})
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    report_path = Path(args.report).resolve()
    output = Path(args.output).resolve()
    if output.exists():
        parser.error("Output directory must be new")
    output.mkdir(parents=True)
    report = json.loads(report_path.read_text())
    trials = report.get("trials") if isinstance(report, dict) else None
    if not isinstance(trials, list):
        raise SystemExit("Report has no trial list")
    if any(not isinstance(item, dict) for item in trials):
        raise SystemExit("Report contains malformed trial records")
    rows = [trial_row(item) for item in trials]
    comparisons = pairs(rows)
    guided = [row for row in rows if row["guidedDiagnosticOnly"]]
    payload = {"sourceReport": str(report_path), "studyStatus": report.get("status"), "partialReport": report.get("status") != "completed" or len(rows) != len(report.get("plan", [])), "model": report.get("model"), "effort": report.get("effort"), "workers": report.get("workers"), "limitations": ["Main model input may rise even when Jev provider usage is low.", "Provider usage and reported gateway billing are separate from main-agent usage; main-agent cost is not reported.", "Two workers and elapsed time are confounded by concurrency.", "Guided arms are one-repeat diagnostics and cannot establish default-policy benefit.", "Only eligible complete baseline/optional pairs support token-benefit observations; this is not statistical proof."], "trials": rows, "pairedComparisons": comparisons, "guidedDiagnostics": guided}
    (output / "summary.json").write_text(json.dumps(payload, indent=2, default=str) + "\n")
    write_csv(output / "trials.csv", rows)
    eligible = [item for item in comparisons if item["eligible"]]
    lines = ["# Complexity study summary", "", f"Study status: `{payload['studyStatus']}`; partial report: `{payload['partialReport']}`.", f"Model: `{payload['model']}`; effort: `{payload['effort']}`; workers: `{payload['workers']}`.", "", f"Trials received: {len(rows)}; eligible paired baseline/optional comparisons: {len(eligible)}; guided diagnostics: {len(guided)}.", "", "## Interpretation", ""]
    if not eligible:
        lines.append("No eligible paired comparison supports an inference about Jev token benefit. Missing calls, incomplete telemetry, failed quality, or a partial report remain diagnostic/adoption observations only.")
    lines.extend(["", "## Paired observations", ""])
    if not comparisons:
        lines.append("No baseline/optional pair was present in the report.")
    for item in comparisons:
        if not item.get("numericUsageComparable"):
            lines.append(f"- {item['level']} repeat {item['repeat']}: numeric token delta unavailable; reason: {item.get('reason')}.")
            continue
        input_delta = "unknown" if item.get("inputDeltaPercent") is None else f"{item['inputDeltaPercent']:.2f}%"
        nominal_delta = "unknown" if item.get("mainNominalTokenDeltaPercent") is None else f"{item['mainNominalTokenDeltaPercent']:.2f}%"
        lines.append(f"- {item['level']} repeat {item['repeat']}: main-input delta {input_delta}, nominal main-token delta {nominal_delta}; attribution eligible: `{item.get('attributionEligible')}`; reason: {item.get('reason')}.")
    lines.extend(["", "## Limitations", ""] + [f"- {item}" for item in payload["limitations"]] + ["", "## Files", "", "- `summary.json` contains every trial and comparison fields.", "- `trials.csv` contains one row per trial."])
    (output / "summary.md").write_text("\n".join(lines) + "\n")
    print(json.dumps({"output": str(output), "trials": len(rows), "eligiblePairs": len(eligible), "partialReport": payload["partialReport"]}))


if __name__ == "__main__":
    main()

import argparse
import csv
import json
import math
from pathlib import Path


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def strict_sum(values):
    if not values or any(number(value) is None for value in values):
        return None
    return sum(values)


def usage_row(trial):
    usages = trial.get("mainUsage") or []
    input_tokens = strict_sum([item.get("input_tokens") for item in usages])
    cached = strict_sum([item.get("cached_input_tokens") for item in usages])
    output = strict_sum([item.get("output_tokens") for item in usages])
    provider = trial.get("providerCalls") or []
    provider_input = strict_sum([item.get("usage", {}).get("input_tokens") for item in provider])
    provider_output = strict_sum([item.get("usage", {}).get("output_tokens") for item in provider])
    market = [item.get("providerMetadata", {}).get("gateway", {}).get("marketCost") for item in provider]
    try:
        market = [float(value) for value in market]
    except (TypeError, ValueError):
        market = []
    market_cost = sum(market) if market and all(math.isfinite(value) and value >= 0 for value in market) else None
    return {"mainInputTokens": input_tokens, "mainCachedInputTokens": cached,
            "mainUncachedInputTokens": input_tokens - cached if input_tokens is not None and cached is not None else None,
            "mainOutputTokens": output, "mainNominalTokenSum": input_tokens + output if input_tokens is not None and output is not None else None,
            "providerInputTokens": provider_input, "providerOutputTokens": provider_output,
            "providerMarketCost": market_cost}


def primary_pass(trial):
    acceptance = trial.get("acceptance") or {}
    if "passed" not in acceptance:
        return None
    return acceptance.get("passed") is True and trial.get("agentExitCode") == 0 and trial.get("timedOut") is False


def pct(before, after):
    if before is None or after is None or before == 0:
        return None
    return (after - before) / before * 100


def eligible_trial(row):
    return (row.get("primaryAcceptancePass") is True and row.get("timedOut") is False and
            row.get("protocolCompliant") is True and row.get("telemetryValid") is True and
            row.get("contractUnchanged") is True and row.get("usageAvailable") is True and
            row.get("providerUsageComplete") is True and row.get("status") == "complete" and
            row.get("mainInputTokens") is not None and row.get("mainCachedInputTokens") is not None and
            row.get("mainCachedInputTokens") <= row.get("mainInputTokens") and
            row.get("mainOutputTokens") is not None and not row.get("errors") and
            not row.get("telemetryParseErrors"))


def trial_row(spec, trial):
    row = {**spec}
    if trial is None:
        row.update({"status": "missing", "primaryAcceptancePass": None, "protocolCompliant": None,
                    "telemetryValid": None, "timedOut": None, "sourceChanges": None,
                    "contractUnchanged": False, "usageAvailable": False,
                    "providerUsageComplete": False, "providerUsageStatus": "unknown"})
        row.update({key: None for key in ("mainInputTokens", "mainCachedInputTokens", "mainUncachedInputTokens",
                                          "mainOutputTokens", "mainNominalTokenSum", "providerInputTokens",
                                          "providerOutputTokens", "providerMarketCost")})
        return row
    row.update(usage_row(trial))
    row.update({"status": "complete", "primaryAcceptancePass": primary_pass(trial),
                "protocolCompliant": trial.get("protocolCompliant"), "telemetryValid": trial.get("telemetryValid"),
                "timedOut": trial.get("timedOut"), "elapsedSeconds": trial.get("elapsedSeconds"),
                "sourceChanges": trial.get("sourceChanges"), "changedFiles": trial.get("changes"),
                "contractUnchanged": trial.get("contractUnchanged"), "usageAvailable": trial.get("usageAvailable"),
                "providerUsageComplete": trial.get("providerUsageComplete"),
                "telemetryParseErrors": trial.get("telemetryParseErrors") or [],
                "errors": trial.get("errors") or []})
    provider_calls = trial.get("providerCalls") or []
    if trial.get("arm") == "native":
        row["providerUsageStatus"] = "not_applicable"
    elif not provider_calls and trial.get("providerUsageComplete") is True:
        row["providerUsageStatus"] = "not_needed"
    elif provider_calls and all(call.get("status") in ("provider_success", "success") for call in provider_calls):
        row["providerUsageStatus"] = "complete" if trial.get("providerUsageComplete") is True and row["providerInputTokens"] is not None and row["providerOutputTokens"] is not None else "unknown"
    elif any(call.get("status") in ("provider_error", "error") for call in provider_calls):
        row["providerUsageStatus"] = "failed"
    else:
        row["providerUsageStatus"] = "unknown"
    if row["timedOut"] or trial.get("agentExitCode") not in (0, None) or trial.get("agentExitCode") is None or row["errors"] or row["telemetryParseErrors"] or row["contractUnchanged"] is not True or (trial.get("arm") != "native" and trial.get("providerUsageComplete") is not True):
        row["status"] = "failed_or_partial"
    row["qualityOutcome"] = "pass" if row["primaryAcceptancePass"] else "fail" if row["primaryAcceptancePass"] is False else "unknown"
    return row


def pair_rows(rows):
    groups = {}
    for row in rows:
        groups.setdefault((row.get("level"), row.get("variant"), row.get("repeat")), {})[row.get("arm")] = row
    pairs = []
    for key, arms in sorted(groups.items()):
        native = arms.get("native")
        prepared = arms.get("prepared")
        jev = arms.get("jev")
        item = {"level": key[0], "variant": key[1], "repeat": key[2],
                "native": native.get("name") if native else None, "prepared": prepared.get("name") if prepared else None,
                "jev": jev.get("name") if jev else None}
        for arm in ("prepared", "jev"):
            row = arms.get(arm)
            item[arm + "QualityComparison"] = "unknown"
            if native and row and native.get("primaryAcceptancePass") is not None and row.get("primaryAcceptancePass") is not None:
                if native["primaryAcceptancePass"] == row["primaryAcceptancePass"]:
                    item[arm + "QualityComparison"] = "tie"
                elif row["primaryAcceptancePass"]:
                    item[arm + "QualityComparison"] = "win"
                else:
                    item[arm + "QualityComparison"] = "loss"
            for field in ("mainInputTokens", "mainCachedInputTokens", "mainUncachedInputTokens", "mainOutputTokens", "mainNominalTokenSum", "providerInputTokens", "providerOutputTokens", "providerMarketCost"):
                item[arm + field[0].upper() + field[1:] + "DeltaPercent"] = pct(native.get(field) if native else None, row.get(field) if row else None)
            item[arm + "Eligible"] = bool(native and row and all(eligible_trial(item_row) for item_row in (native, row)))
        item["jevVsPreparedQualityComparison"] = "unknown"
        if prepared and jev and prepared.get("primaryAcceptancePass") is not None and jev.get("primaryAcceptancePass") is not None:
            item["jevVsPreparedQualityComparison"] = "tie" if prepared["primaryAcceptancePass"] == jev["primaryAcceptancePass"] else "win" if jev["primaryAcceptancePass"] else "loss"
        for field in ("mainInputTokens", "mainCachedInputTokens", "mainUncachedInputTokens", "mainOutputTokens", "mainNominalTokenSum", "providerInputTokens", "providerOutputTokens", "providerMarketCost"):
            item["jevVsPrepared" + field[0].upper() + field[1:] + "DeltaPercent"] = pct(prepared.get(field) if prepared else None, jev.get(field) if jev else None)
        item["jevVsPreparedEligible"] = bool(prepared and jev and all(eligible_trial(item_row) for item_row in (prepared, jev)))
        pairs.append(item)
    return pairs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    if output.exists():
        parser.error("Output directory must be new")
    output.mkdir(parents=True)
    report = json.loads(Path(args.report).read_text())
    plan = report.get("plan", [])
    by_name = {trial.get("name"): trial for trial in report.get("trials", []) if isinstance(trial, dict)}
    rows = [trial_row(spec, by_name.get(spec.get("name"))) for spec in plan]
    unexpected = [trial for trial in report.get("trials", []) if trial.get("name") not in {spec.get("name") for spec in plan}]
    pairs = pair_rows(rows)
    quality = {}
    for arm in ("prepared", "jev"):
        quality[arm] = {"win": sum(pair[arm + "QualityComparison"] == "win" for pair in pairs),
                        "loss": sum(pair[arm + "QualityComparison"] == "loss" for pair in pairs),
                        "tie": sum(pair[arm + "QualityComparison"] == "tie" for pair in pairs)}
    quality["jevVsPrepared"] = {"win": sum(pair["jevVsPreparedQualityComparison"] == "win" for pair in pairs),
                                 "loss": sum(pair["jevVsPreparedQualityComparison"] == "loss" for pair in pairs),
                                 "tie": sum(pair["jevVsPreparedQualityComparison"] == "tie" for pair in pairs)}
    payload = {"sourceReport": str(Path(args.report).resolve()), "studyStatus": report.get("status"),
               "plannedTrials": len(plan), "reportedTrials": len(report.get("trials", [])),
               "unexpectedTrials": unexpected, "trials": rows, "pairedComparisons": pairs,
               "qualityCounts": quality,
               "limitations": ["Three arms are descriptive and do not establish causality or universal savings.",
                               "Main-agent and provider usage are separate; gateway market cost is observational.",
                               "Missing, failed, timed-out, and protocol-incomplete outcomes remain in rows and are ineligible for token comparisons."]}
    (output / "summary.json").write_text(json.dumps(payload, indent=2) + "\n")
    fields = sorted({field for row in rows for field in row})
    with (output / "trials.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    lines = ["# Optimization benchmark summary", "", f"Study status: `{payload['studyStatus']}`. Planned outcomes: {payload['plannedTrials']}; reported outcomes: {payload['reportedTrials']}; unexpected outcomes: {len(unexpected)}.", "", "## Quality comparisons", ""]
    for arm in ("prepared", "jev"):
        lines.append(f"- {arm} versus native: {quality[arm]['win']} wins, {quality[arm]['loss']} losses, {quality[arm]['tie']} ties.")
    lines.append(f"- jev versus prepared: {quality['jevVsPrepared']['win']} wins, {quality['jevVsPrepared']['loss']} losses, {quality['jevVsPrepared']['tie']} ties.")
    lines += ["", "Token and provider deltas are retained per pair in summary.json; no savings approval is inferred.", "", "## Limitations", ""]
    lines.extend("- " + limitation for limitation in payload["limitations"])
    (output / "summary.md").write_text("\n".join(lines) + "\n")
    print(json.dumps({"output": str(output), "plannedTrials": len(plan), "reportedTrials": len(report.get("trials", [])), "pairs": len(pairs)}))


if __name__ == "__main__":
    main()

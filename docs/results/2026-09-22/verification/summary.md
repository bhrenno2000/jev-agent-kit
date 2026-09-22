# Verification study summary

Study status: `completed`. Planned outcomes: 24; reported outcomes: 24; unexpected outcomes: 0.

## Quality and protocol

Primary acceptance verified wins: 0; losses: 0; ties: 12.
Protocol compliance and telemetry validity remain separate fields per trial; failures, timeouts, review errors, missing calls, and missing usage remain in the output.

## Capability judgments

Expected true: 48; expected false: 48; decisive correct: 45; decisive wrong: 0; abstentions: 51.
False approvals on defective positive claims: 0; false alarms on correct properties: 0; positive/inverse contradictions: 0.

## Limitations

- Small authored replicates do not establish statistical or universal claims.
- Main-agent cost is not reported; provider usage and gateway billing remain separate unknown/cost fields.
- A token delta is descriptive only and cannot prove savings when quality worsens or output rises.
- Reference source changes are recorded as edits and are not automatic failures.
- Eligible pairs require complete main/provider metrics, verified original-source provenance, and contract-unchanged evidence.

## Files

- `summary.json` contains every planned outcome, pair, and capability metric.
- `trials.csv` contains one row per planned outcome, including missing outcomes.

## Post hoc label sensitivity

Low validation claim does not define structural records versus plain objects.
The original frozen-label totals above are retained. The following subset excludes the disclosed ambiguous claims; this was not a preregistered score.
Subset judgments: 88; decisive label matches: 38; decisive disagreements: 0; abstentions: 50.

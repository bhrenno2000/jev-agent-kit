# Complexity study summary

Study status: `completed`; partial report: `False`.
Model: `gpt-6-astra`; effort: `xhigh`; workers: `2`.

Trials received: 15; eligible paired baseline/optional comparisons: 0; guided diagnostics: 3.

## Interpretation

No eligible paired comparison supports an inference about Jev token benefit. Missing calls, incomplete telemetry, failed quality, or a partial report remain diagnostic/adoption observations only.

## Paired observations

- high repeat 1: main-input delta 19.93%, nominal main-token delta 18.74%; attribution eligible: `False`; reason: optional arm made no verified Jev inference call.
- high repeat 2: main-input delta -34.67%, nominal main-token delta -33.50%; attribution eligible: `False`; reason: optional arm made no verified Jev inference call.
- low repeat 1: main-input delta -1.09%, nominal main-token delta -0.72%; attribution eligible: `False`; reason: optional arm made no verified Jev inference call.
- low repeat 2: main-input delta 0.95%, nominal main-token delta 0.79%; attribution eligible: `False`; reason: optional arm made no verified Jev inference call.
- medium repeat 1: main-input delta -22.73%, nominal main-token delta -21.84%; attribution eligible: `False`; reason: optional arm made no verified Jev inference call.
- medium repeat 2: main-input delta -16.44%, nominal main-token delta -15.52%; attribution eligible: `False`; reason: optional arm made no verified Jev inference call.

## Limitations

- Main model input may rise even when Jev provider usage is low.
- Provider usage and reported gateway billing are separate from main-agent usage; main-agent cost is not reported.
- Two workers and elapsed time are confounded by concurrency.
- Guided arms are one-repeat diagnostics and cannot establish default-policy benefit.
- Only eligible complete baseline/optional pairs support token-benefit observations; this is not statistical proof.

## Files

- `summary.json` contains every trial and comparison fields.
- `trials.csv` contains one row per trial.

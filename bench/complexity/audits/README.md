# Secondary contract audit

This audit supplements the frozen 14-case high-complexity acceptance suite. It was designed during the live study before reviewing high-task agent solutions. It does not replace or rewrite the registered primary results.

Independent review identified four contract gaps: preserving existing input validation, rejecting a second reservation for the same order, retaining the original idempotent result after checkout, and restoring complete state on persistence failure. The original reference failed input-validation probing, even though it passed the primary acceptance suite. That defect is retained as a limitation of the original oracle coverage.

Run this script separately against each completed high-task workspace with `BENCH_WORKSPACE` pointing to that workspace. Report every result alongside the primary acceptance result. A primary pass does not overrule a failed secondary contract check.

```sh
BENCH_WORKSPACE=/absolute/path/to/candidate node bench/complexity/audits/high-contract.mjs
```

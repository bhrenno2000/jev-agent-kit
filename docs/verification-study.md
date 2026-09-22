# Jev as an advisory code verifier

This follow-up tests a different role from source selection: checking four explicit claims about a proposed implementation. The original source-selection study remains unchanged. The production adapter is unchanged; the new MCP wrapper is experimental and is not exported by the installed package.

## Protocol and scope

The frozen protocol is at commit `70a3e32fc4093f5112754191dac0184c9f0180a1`. It specifies 24 complete review trajectories: three authored tasks, defective and intended-correct inputs, native or Jev-assisted review, and two repetitions. Both arms receive the same requirements and four-claim checklist. The assisted arm must call the experimental verifier before editing and then independently reason, inspect source, and test. Public tests pass on both initial versions; external acceptance tests distinguish the known defects from the reference.

The tasks are interval planning, a scoped asynchronous cache, and partitioned event ingestion with concurrent atomic commits. Complexity refers to interacting behavior, not repository size. Their bounded source is only a few kilobytes, so this is not a large-repository study. Main model and effort are held at `gpt-6-astra` and `xhigh`; two workers share a host. Every failure, timeout, protocol violation, and source modification must remain visible.

The experimental `jev_verify_claims` MCP reads the pinned fixture source and neutral contract directly. It sends complete bounded evidence to Jev and returns four judgments plus source hashes. The main agent supplies no copied source in its tool arguments. This removes the source-transcription cost of calling a general evaluator and does not remove the agent's normal access to code or tests.

## Direct capability and label audit

The direct test made 12 calls: each of the six frozen inputs twice, with four properties and their logical inverses. It produced 96 judgments with 48 expected true and 48 expected false. The thresholds were fixed before the calls: at least 0.8 means supported, at most 0.2 means contradicted, and intermediate values abstain. These thresholds are a research policy, not calibrated probabilities of code correctness.

Under the original authored labels, 45 decisive answers matched, 51 abstained, and no decisive answer disagreed. Repeated judgments and inverse phrasings are not independent examples; these are 24 implementation/property combinations, not 96 independent programming tasks.

Independent review then identified an ambiguity in the low task's validation claim. The requirement says an array of records without defining structural records versus plain objects. Both initial implementations accept arrays or functions with integer `start` and `end` properties. Review agents chose to reject these values, while the frozen label treats the validation property as satisfied. Neither interpretation should be silently converted into a universal ground truth after seeing outcomes.

The sensitivity analysis therefore keeps the original 96 results and separately excludes that claim and its inverse in both versions and repetitions. The remaining 88 judgments have 38 decisive label matches and 50 abstentions. No decisive disagreement was observed on that subset. This exclusion is post hoc and must be disclosed; it is not a revised frozen score or proof of zero real-world errors. Low reference inputs remain intended clean controls with this validation-domain limitation. Their stricter type checks cannot automatically be called unnecessary edits.

Direct calls reported 20,952 input and 1,988 output tokens over 12 HTTP attempts. This is separate from the coding agents' usage and does not include orchestration or review effort.

## Completed original review trajectories

All 24 agents finished within their limits and passed their external acceptance suites. Native review passed 12/12 and Jev-assisted review passed 12/12. Both arms repaired all six defective-input runs and passed all six intended-reference runs. Every assisted agent made a successful verifier call against the original source before edits. Contracts and source provenance checks passed. Product source/build, runner, wrapper, and frozen fixture hashes remained unchanged throughout the study.

There were no paired quality wins or losses: all twelve pairs tied under external acceptance. Native review already passed every case, so this study provides no evidence that Jev improved delivery accuracy. Acceptance is not exhaustive correctness, and the low validation ambiguity limits how its reference edits can be interpreted.

| Level  | Native main tokens | Assisted main tokens | Difference | Approval in each arm |
| ------ | -----------------: | -------------------: | ---------: | -------------------: |
| Low    |            782,920 |              606,728 |    -22.50% |                  4/4 |
| Medium |            626,770 |              624,940 |     -0.29% |                  4/4 |
| High   |            719,873 |              782,837 |     +8.75% |                  4/4 |
| Total  |          2,129,563 |            2,014,505 |     -5.40% |                12/12 |

These are sums of main-agent input plus output over four trajectories per arm and level. Cached input is already part of input and is not added again. Reasoning output is already part of output. The total is a descriptive result for this task mix, not an expected savings rate on other work. Six pairs used fewer main tokens with Jev and six used more. Pair differences ranged from -33.19% to +46.00%; high-reference pairs increased by +46.00% and +38.24%.

Main uncached input decreased from 324,815 to 307,683 (-5.27%), and output decreased from 64,844 to 60,742. Jev itself additionally reported 17,700 input and 968 output tokens for twelve successful calls and twelve HTTP attempts. Median reported provider latency was 764.5 ms. Gateway-reported charged cost was `0` and market cost was `0.000743400`; those observations do not establish future pricing or total main-agent dollar cost. Tokenizers and prices differ across models, so the main-agent percentage is not a unified financial saving. Direct capability calls, fixture development, orchestration, and reviewer effort are outside that main-agent comparison.

All medium and high reference source files remained unchanged in both repetitions and both arms; agents added tests. All four low reference runs added stricter record-type validation, which falls under the disclosed requirement ambiguity. The source modifications are retained rather than silently counted as either regressions or improvements.

## Protocol deviations and supplementary controls

The original medium `package.json` names exposed `candidate` versus `reference`, despite opaque trial-directory names. This is a variant-blinding limitation. The paired arms received identical files for each input, and the Jev wrapper did not send package metadata to the provider, but the main reviewer could see the cue. Do not interpret the original medium clean-control behavior as fully blinded.

After identifying the two limitations, four additional clean-input reviews were declared separately: native and assisted review on low and medium, one repetition each. The low contract explicitly defines record types and its reference validates that domain. Medium package names are identical and neutral. Original outcomes remain unchanged; supplementary observations are not substituted for trials or pooled as randomized replications.

All four supplementary agents passed their external checks, preserved all source files, and satisfied protocol and integrity checks. The low control had five external tests and the medium control had fourteen.

| Supplementary clean input    | Native main tokens | Assisted main tokens | Difference | Source edits       |
| ---------------------------- | -----------------: | -------------------: | ---------: | ------------------ |
| Low, clarified record domain |            128,696 |              137,858 |     +7.12% | None in either arm |
| Medium, neutral package name |            155,809 |              138,007 |    -11.43% | None in either arm |

These single additional pairs reinforce variability rather than a stable savings rule: the low control reverses the original low-level direction, while the medium control shows a larger decrease. The [supplementary records](results/2026-09-22/verification-clean-controls/) include their distinct frozen commit and protocol. Their patches, final workspace hashes, and acceptance outcomes also reproduced from clean copies. Across both cohorts, 28/28 review deliveries passed their respective external checks, with native and assisted review tied at 14/14 each. That count is descriptive across different inputs and is not a pooled causal estimate.

## Interpretation and evidence

The experiment supports an operationally useful distinction: the direct-reading verifier adds a small advisory result without requiring source transcription into tool arguments. It preserved the agent's normal source access and testing workflow in these runs. It does not establish greater intelligence, general accuracy improvement, universal token savings, or safety as an automatic release gate.

The high-complexity token increase and frequent inconclusive capability judgments prevent approval for mandatory use. Optional use for explicit, bounded claims remains an experiment worth measuring on representative work. No quality improvement or net financial saving was established. The production tools and user client configuration remain unchanged.

The [original results](results/2026-09-22/verification/) contain the frozen protocol, all 24 outcomes, exact patches, acceptance output, provider telemetry, command records, usage tables, and the post hoc label sensitivity analysis. All 24 exported patches were reapplied to fresh frozen inputs: both final workspace hashes and external outcomes reproduced exactly. Raw local traces are represented by hashes and are retained outside the repository; credentials and unrelated user data are excluded.

The final comment-policy review checked all 177 JavaScript modules across the 28 resulting workspaces and found no source comments or workspace symlinks. This is an artifact check, not a security certification or proof of exhaustive behavioral correctness.

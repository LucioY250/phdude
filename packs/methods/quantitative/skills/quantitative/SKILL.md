---
name: quantitative
description: Method guidance and review questions for quantitative research - hypothesis testing, surveys, and experimental design.
phdude:
  version: 1
  reads: [knowledge/claims/**, knowledge/evidence/**, knowledge/facts/**, research/questions/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# Quantitative Method Pack

Follow `[[phdude-core]]`. This pack refines vocabulary and review questions for quantitative
research; it does not change the core evidence rules.

## What counts as evidence here

- **Experimental data** - randomized manipulation with a measured outcome.
- **Survey/correlational data** - measured variables without manipulation.
- **Statistical tests** - the specific test, its assumptions, and its result (statistic,
  p-value, effect size, confidence interval).
- **Instrument reliability** - reported reliability (e.g., Cronbach's alpha) for any scale used.

A p-value alone, without an effect size and sample description, is incomplete evidence.

## Common designs

- **Randomized experiment** - manipulated independent variable, random assignment to
  conditions.
- **Quasi-experiment** - manipulated or naturally occurring variable without full
  randomization.
- **Cross-sectional survey** - measured variables at one point in time, analyzed for
  association (correlation, regression).
- **Longitudinal/panel** - repeated measures over time on the same units.

## Analysis

An analysis is a declared object, not a conversation. Register the data with `phdude data add`,
declare the script with `phdude analyze add`, and let `phdude analyze run` execute it - the run
records what it read and what it wrote, and every finding becomes a `RESULT` you can cite. Never
run a script yourself: a number nobody can reproduce is not evidence.

What the scripts in this paradigm usually do, in the order they usually do it:

- **Describe before testing.** N per group, missing data and how it was handled, distributions,
  and the outliers you decided to keep or drop. A test reported without this is unreadable.
- **Check the assumptions the test makes**, and report the check rather than the conclusion:
  normality, homoscedasticity, independence, and for regression the collinearity and the
  residuals.
- **Run the pre-specified test**, and say plainly when a test was chosen after seeing the data.
- **Estimate the effect**, not only its significance: the effect size with its confidence
  interval, in the units a reader thinks in.
- **Say what would change the answer.** A sensitivity analysis, an alternative specification, or
  the subgroup where the effect disappears.

What a `RESULT` from this paradigm has to carry in its `values`: the statistic and its degrees of
freedom, the p-value, the effect size and its interval, and the n behind it. The `summary` is the
finding in one sentence, in the language the design licenses - "associated with" for a survey,
"increased" only for a randomized manipulation. Two runs that disagree are two results, and the
older one is superseded rather than quietly overwritten.

Report every analysis you ran, not only the one that worked. A table of the pre-registered
comparison plus a figure of the effect is usually enough; both are declared with `phdude table
add` and `phdude figure add`, the figure carries alt text that states the finding, and
`phdude repro check` stays clean so the numbers in the manuscript are the numbers on disk.

## Review questions

- Was a power analysis (a priori or reported post hoc) used to justify the sample size?
- Are the test's assumptions (normality, homoscedasticity, independence) checked and
  reported, not merely assumed?
- Is effect size reported alongside the p-value, not significance alone?
- Is the sample representative of the population the claim is about, and is the sampling
  method (random, convenience, stratified) named?
- Was correction for multiple comparisons applied when many tests were run?
- For scales/instruments, is reliability (e.g., Cronbach's alpha) and, ideally, validity
  evidence reported?

## Epistemic norms

Wording must match the design: a properly randomized experiment supports causal language
("X increased Y"); a correlational survey supports only "associated with" or "predicts" language,
never causal wording, regardless of how strong the correlation is. A single underpowered study
should be hedged as "provides preliminary evidence," even if the p-value is significant; a
well-powered, pre-registered, and independently replicated finding may be stated more plainly.
Statistical significance (p < .05) alone does not establish practical importance - always pair
significance language with the effect size, and note when an effect is statistically significant
but small.

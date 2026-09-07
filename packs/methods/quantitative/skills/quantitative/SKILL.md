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

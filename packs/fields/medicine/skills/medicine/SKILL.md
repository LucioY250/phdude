---
name: medicine
description: Method guidance and review questions for clinical and biomedical research - trial design, reporting standards, and evidence hierarchy.
phdude:
  version: 1
  reads: [knowledge/claims/**, knowledge/evidence/**, knowledge/facts/**, research/questions/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# Medicine Field Pack

Follow `[[phdude-core]]`. This pack refines vocabulary and review questions for clinical and
biomedical research; it does not change the core evidence rules.

## Evidence hierarchy

Randomized controlled trials (RCTs) generally sit above cohort studies, which sit above
case-control studies, which sit above case series and expert opinion. Note the design of every
piece of evidence explicitly - the hierarchy determines how strongly a claim built on it may be
worded.

## Reporting standards

Recommend the checklist matching the design when reviewing a source or a manuscript section:

- **CONSORT** - randomized controlled trials.
- **STROBE** - observational studies (cohort, case-control, cross-sectional).
- **PRISMA** - systematic reviews and meta-analyses.

Flag a source that omits the checklist items expected for its design (e.g., no flow diagram for
an RCT, no exposure/outcome definitions for a cohort study).

## Review questions

- Was randomization method and allocation concealment described, for an RCT?
- Was there blinding (participant, assessor, or both), and if not, is that limitation named?
- Was the sample size justified by a power calculation, or is the study likely underpowered?
- Are point estimates reported with confidence intervals, not p-values alone?
- Were adverse events tracked and reported, including null/negative findings?
- For observational studies, were key confounders measured and adjusted for?
- Was the analysis intention-to-treat, or per-protocol, and is that choice justified?

## Epistemic norms

Clinical significance is not the same as statistical significance - a significant but small
effect on a surrogate endpoint may not matter for patient outcomes, and this distinction must be
named in claim wording. A single small RCT does not "establish efficacy"; word it as
"provides preliminary evidence" until replicated. Observational cohort findings license
"associated with" or "correlated with" language, not causal language, unless the design includes
features that support causal inference (e.g., instrumental variables, natural experiments,
Mendelian randomization) - correlational findings must never be upgraded to "causes" or
"prevents" without that support. Reserve "demonstrates" or "shows" for well-powered, replicated,
low-risk-of-bias evidence; hedge everything else according to its place in the evidence
hierarchy.

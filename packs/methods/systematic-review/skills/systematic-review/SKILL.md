---
name: systematic-review
description: Method guidance and review questions for systematic reviews and meta-analyses - search strategy, screening, risk of bias, and pooled effects.
phdude:
  version: 1
  reads: [knowledge/claims/**, knowledge/evidence/**, knowledge/sources/**, research/questions/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# Systematic Review Method Pack

Follow `[[phdude-core]]`. This pack refines vocabulary and review questions for systematic
reviews and meta-analyses; it does not change the core evidence rules.

## What counts as evidence here

- **A registered protocol** - pre-specified research question, inclusion/exclusion criteria,
  and analysis plan (e.g., PROSPERO registration).
- **A documented search strategy** - databases searched, search strings, and date range.
- **A PRISMA flow diagram** - records identified, screened, excluded (with reasons), and
  included.
- **Risk-of-bias assessments** - per-study, using a named tool (e.g., Cochrane RoB 2).
- **A pooled effect** - with heterogeneity statistics, when meta-analyzed.

A narrative summary of "several studies found X" without a documented search and selection
process is a literature summary, not a systematic review, and should be labeled as such.

## Review questions

- Was the search strategy comprehensive and reproducible - multiple databases, documented
  search strings, and a stated date range?
- Was study selection performed independently by two reviewers, with a documented process for
  resolving disagreement?
- Was risk of bias assessed per included study using a named, appropriate tool?
- Was heterogeneity (I², Q-statistic) assessed, and does the pooling method (fixed vs.
  random-effects) match the observed heterogeneity?
- Was publication bias assessed (e.g., funnel plot, Egger's test) when enough studies were
  pooled to make this meaningful?
- Are excluded studies and exclusion reasons documented, not just the included set?

## Epistemic norms

A pooled effect claim is only as strong as the quality and consistency of the included studies -
report it with its confidence interval and heterogeneity statistic, not as a single clean number.
When heterogeneity is high (e.g., I² > 75%), avoid stating a single pooled effect as
generalizable; instead describe the range of effects across studies or subgroups, and note
possible sources of heterogeneity (population, setting, measurement). A review with a narrow,
incomplete search, or with most included studies at high risk of bias, should have its
conclusions hedged accordingly ("the available evidence suggests," not "establishes"), and any
mismatch between the review's stated scope and the actual included studies must be named.

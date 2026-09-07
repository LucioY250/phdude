---
name: qualitative
description: Method guidance and review questions for qualitative research - interviews, thematic analysis, grounded theory, and ethnography.
phdude:
  version: 1
  reads: [knowledge/claims/**, knowledge/evidence/**, knowledge/facts/**, research/questions/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# Qualitative Method Pack

Follow `[[phdude-core]]`. This pack refines vocabulary and review questions for qualitative
research; it does not change the core evidence rules.

## What counts as evidence here

- **Raw data** - interview transcripts, focus group recordings, field notes, documents.
- **Coding artifacts** - a coding scheme, code definitions, and an audit trail of how codes
  were applied.
- **Themes** - patterns identified across coded data, tied to specific excerpts.
- **Triangulation** - agreement (or documented disagreement) across data sources or coders.

A "theme" asserted without excerpts tying it to the coded data is `candidate`, not `supported`.

## Common approaches

- **Thematic analysis** - inductive or deductive coding to identify patterns across data.
- **Grounded theory** - iterative coding and theoretical sampling toward an emergent theory.
- **Ethnography** - sustained observation and participation in a setting.
- **Case study** - in-depth analysis of one bounded case using multiple data sources.

## Analysis

Qualitative analysis is still analysis: the coding is the method, and a claim that rests on it
owes a record of how the codes were applied. Register transcripts and coding exports with
`phdude data add`, declare the script that summarises them with `phdude analyze add`, and let
`phdude analyze run` produce the `RESULT` objects you cite. Interpretation stays yours; what the
workspace holds is the count, the code and the excerpt behind it.

What the scripts in this paradigm usually do:

- **Summarise the corpus.** How many interviews, of what length, from which participants, and how
  much of it was coded.
- **Report the coding, not only the themes.** Codes per transcript, the passages behind each
  theme, and when a code was added, split or retired.
- **Quantify agreement where more than one coder worked.** Inter-coder agreement per code, and
  the codes it was worst on - the disagreement is a finding, not a defect to hide.
- **Show saturation as evidence.** New codes per interview over the sequence, so "saturation was
  reached" is a curve rather than an assertion.

What a `RESULT` from this paradigm has to carry in its `values`: counts a reader can check - the
transcripts, the coded segments, the participants a theme appears in - never a percentage that
implies a sample it does not have. The `summary` names the pattern and its scope in one sentence:
"participants in this study described...", not "most people".

A figure here shows structure, not significance: codes per theme, or new codes over the interview
sequence. Declare it with `phdude figure add` and write alt text that states what it shows.
Quotes stay in the prose, tied to a code and a participant, and never in a chart.

## Review questions

- Was saturation reached and justified with evidence (e.g., no new codes in the last N
  interviews), rather than simply asserted?
- Was coding checked for reliability - inter-coder agreement, or an audit trail if coded by
  one researcher - rather than accepted as authoritative from a single unchecked pass?
- Are quotes used as illustrative evidence explicitly tied to a named code or theme, not
  selected to fit a conclusion decided in advance?
- Is the sampling strategy (purposive, theoretical, snowball) justified relative to the
  research question, and are participant characteristics described?
- Does the write-up include a reflexivity statement addressing the researcher's position and
  its potential influence on interpretation?
- Was triangulation attempted across data sources, methods, or coders, and are disagreements
  reported rather than silently resolved?

## Epistemic norms

Qualitative findings describe patterns within the specific sample and context studied - avoid
statistical-sounding generalization such as "most participants" or "the majority" unless a count
is reported and its limits (small, non-random sample) are stated alongside it. Prefer scope-
limited phrasing: "participants in this study described...," "a recurring pattern in the
interviews was...". A claimed "theme" requires it to be traceable to triangulated coded data, not
a single vivid quote. Do not present an emergent theory or interpretation as generalizable beyond
the studied setting without an explicit argument for transferability.

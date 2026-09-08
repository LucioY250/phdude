---
name: example-field
description: Field guidance and review questions for science and technology studies - what counts as evidence in an interpretive field study, and how to write about it without overclaiming.
phdude:
  version: 1
  reads: [knowledge/claims/**, knowledge/evidence/**, knowledge/facts/**, research/questions/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# Example Field Pack

Follow `[[phdude-core]]`. This pack refines vocabulary and review questions for an interpretive
field study; it does not change the core evidence rules. It ships as an example of what a
third-party pack looks like, and everything below is real guidance rather than filler.

## What counts as evidence here

- **Field notes** — dated observation, with the observer named and the setting described.
- **Interview material** — the transcript segment, not a paraphrase, with the speaker's role and
  the consent under which it was recorded.
- **Documents from the setting** — standards, tickets, minutes, code review threads: the
  artifacts the participants themselves made.
- **Traces** — logs, versions, changesets, where the setting is a technical one.

A quotation without its context is not evidence, because an interpretive claim rests on the
situation the quotation came from as much as on the words.

## Writing about it

Attribute every interpretation to the material it rests on. "Operators treated the alarm as
noise" is a claim; the field note and the two interviews behind it are the evidence, and
`phdude link` is what connects them. Where a reading is contested in the setting, record the
disagreement as a contradiction rather than choosing the tidier account.

Frequency language needs a denominator. "Most engineers" is a claim about a count you either
made or did not; if you did not, say "the engineers I observed" and name how many there were.

## Review questions

- Is the researcher's position in the setting stated, and its effect on access discussed?
- Does each interpretation name the material it rests on, and is that material in the workspace?
- Is consent recorded for every quoted participant, and are identifying details handled?
- Are negative cases reported, or only the material that fits the reading?
- Is the setting described in enough detail that a reader can judge what transfers?

## Epistemic norms

An interpretive study licenses claims about the setting it studied. Generalization beyond it is
an argument the author has to make explicitly, not a wording choice: write "in this laboratory"
until you have grounds for more. Causal language belongs to a design that can support it; here,
prefer "participants accounted for", "the practice was organized around", "operators treated".

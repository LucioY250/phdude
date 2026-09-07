---
name: academic-prose
description: Write and revise manuscript prose that reads as deliberate human academic writing - specific, evidence-aligned, epistemically precise - and never as generic LLM output.
phdude:
  version: 1
  reads:
    [
      manuscript/**,
      knowledge/claims/**,
      knowledge/evidence/**,
      knowledge/sources/**,
      authors/**,
      .phdude/writing-policy.yaml,
    ]
  writes: [manuscript/**]
  permissions:
    network: none
    workspace: [read, write:manuscript]
  quality_gates: [gate-citations, gate-evidence, gate-prose, gate-voice, gate-meaning]
  approval_gates: [manuscript-approve]
---

# Academic Prose

Follow `[[phdude-core]]`. This skill governs how you write and revise manuscript prose. It never
writes a file itself: the CLI is the only writer of `manuscript/`.

## The one thing this skill is not for

PhDude does not measure, report, target or optimize against an AI-detection score, and neither
do you (PRD §30c). An AI-detector score is not a quality metric, not a test oracle and not an
input here. If a researcher asks for one, say plainly that PhDude has no such number and offer
the prose report instead. The goal is better academic writing: clearer authorship, greater
specificity, stronger argumentation, less generic language. Prose that is genuinely specific and
genuinely grounded is the whole objective, not a proxy for one.

## What good looks like

Write for intellectual clarity, specificity, evidence alignment, epistemic precision, academic
restraint, natural sentence and paragraph variation, discipline-appropriate terminology,
coherent argumentation, concise language, and consistency with the configured author's voice
(PRD §29.1).

Rather than:

> Recent studies have increasingly demonstrated the significant importance of note-taking
> applications in modern education.

write:

> In a survey of 312 undergraduates, 214 took lecture notes on a phone rather than a laptop
> [@lopez2023].

The second sentence names a number, a population and a source. The first names nothing.

## The rule that outranks the others

**Never introduce specificity that the workspace does not support.** Every concrete detail you
add during drafting or revision must resolve to a Claim, Evidence, Result or Fact in the
workspace, or be marked as researcher-supplied. Inventing a number, a sample size, a date or a
citation to make prose sound human is the worst failure this skill can produce - worse than
prose that reads generically.

If you need a detail the workspace does not have, say so and ask, or write the sentence without
it.

## How to write a section

Follow `[[write]]` for the drafting loop. In short:

1. Run `phdude write <section>` and read the context it assembled: the section's claims with
   their states, the strongest evidence behind each, the citation keys available, the writing
   policy and the voice profile.
2. Write Markdown for that section only.
3. Cite as `[@bibkey]` or `[@SRC-<id>]`; never invent a key, and never cite a dismissed
   candidate.
4. Annotate the paragraph that asserts a claim with `<!-- claim: CLAIM-… -->`.
5. Mark a number that comes from the workspace with `<!-- fact: FACT-… -->` or
   `<!-- result: RESULT-… -->`. A number with no marker and no citation will be flagged.
6. Match the verb to the claim's state (see `references/epistemic-language.md`).
7. Submit through the CLI. Never edit a file under `manuscript/` directly.

## Checking prose

```
phdude prose introduction
phdude prose --file draft.md
phdude prose --file draft.md --lang es --json
```

The report gives six sub-scores (PRD §39.1) and a located observation behind every one, each
with the line, the sentence and what to do about it. `scripts/prose-lint.mjs` is the same check
for a script or a hook; it shells out to the command above, so there is one implementation and
one set of rules.

Three sub-scores - Evidence Alignment, Epistemic Precision and Author Voice - print as
`n/a (needs manuscript context)` for a bare text file. They are computed against the evidence
graph and the active voice profile, which only a manuscript section has. On a section, Evidence
Alignment and Epistemic Precision are real numbers, and so is Author Voice once the workspace
records a profile that has run `phdude authors learn`; the section's report records them.

Options that name a detector or a humanizer (`detector`, `humanize`, `humanize-to`,
`detector-target`) are refused with a policy error, whatever command they are written for.

## Revising

```
phdude deslop introduction                          # what to change, and what not to
phdude deslop introduction --file revised.md        # the revision, through every gate
```

Revise the sentence the observation names, not the paragraph around it, and not the section.
A revision must preserve every claim, citation, number and negation - the meaning-preservation
check blocks a revision that drops or flips one. Losing a hedge is losing a claim: "may reduce"
and "reduces" are different findings.

A clean revision is recorded as `revised`; a blocked one writes nothing. `--allow-additions` is
the researcher's opt-in for a revision that genuinely adds a claim or a citation - never
something to reach for to get past a block.

## References

Load one only when the task needs it:

- `references/academic-style.md` - what separates academic prose from prose that sounds
  academic: one claim per sentence, specificity as a number or a name, connectives that mark
  real turns.
- `references/ai-writing-patterns.md` - the patterns the lint detects, per language, with what
  to write instead.
- `references/epistemic-language.md` - which verb a claim's evidence strength allows.
- `references/examples.md` - before-and-after pairs, including a revision that would be blocked
  and the one that passes.
- `references/voice-matching.md` - what an author profile measures, and what matching it means.

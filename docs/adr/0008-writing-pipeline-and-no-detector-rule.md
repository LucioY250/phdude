# 0008 — The writing pipeline, and the rule against detector scores

**Status:** accepted
**Date:** 2026-09-07

## Context

An agent that can write a plausible thesis section is the easy part; every model does it. The
hard part is that a plausible section and a defensible one look identical on the page. A draft
can cite a source that is not in the registry, restate a claim the workspace rejected, put a
number in a sentence that no fact backs, or say "demonstrates" about evidence rated weak — and
read beautifully while doing it. A supervisor catches these on the third read. A reviewer catches
them at the worst possible moment.

PhDude already knows the answers: which claims are supported, which evidence is weak, which
source resolves to which bibkey, which decisions were approved. v0.4 has to put that knowledge
between the draft and the manuscript, without becoming a text generator itself and without
deciding, on the researcher's behalf, that a section is finished.

Two pressures shape this. The first is that "make the writing better" has an obvious cheap
proxy — an AI-detector score — and users will ask for it. The second is PRD §30c, which names
optimizing for detector scores a **prohibited goal**, so a design that leaves the door open is a
design that will eventually be walked through.

## Decision

**Prose reaches the manuscript through the CLI, and only through it.** The agent writes to a file
and calls `phdude manuscript submit <section> --file <draft.md>`. Nothing else writes under
`manuscript/`: not a file edit, not a skill, not `phdude write`. The one exception is
`phdude prose <section>`, which stores the scores it computed in `manuscript/reports/`, a derived
file that carries no prose.

**Six deterministic gates run on every submit**, each returning findings located to a line:
citations that must resolve, claim and fact markers that must name something real, a prose lint,
a voice comparison, a meaning-preservation diff on revisions, and venue-profile validation. Every
gate is a pure function of the text and a context assembled once by the application layer, so
`submit`, `deslop` and `prose` cannot disagree about the same paragraph.

**A block writes nothing at all** — not the section, not the report, not an event. The findings
reach the researcher through the error, with line numbers, and the workspace is byte-identical to
what it was before the attempt. A pipeline that half-writes on failure is a pipeline whose state
nobody trusts.

**A revision must preserve meaning, and the gate says what that means.** `gate-meaning` extracts
from the old and new text four multisets — claim ids, citation keys, numerals, negation cues —
and blocks a revision that lost any of them. Cues rather than whole sentences, so rewording a
negated sentence is allowed and dropping its "not" is not. Adding a claim or a citation also
blocks unless `--allow-additions`: new assertions belong to a draft, not to a cleanup pass.

**Approval is a human act, enforced the same way `canonical` is.** A section reaches `approved`
only through a Decision that is itself approved and lists `manuscript:<section>` in `affects`.
The section is not an entity, so the decision schema accepts that string form specifically. An
approved section is not overwritten: a later submit exits 3 until `phdude manuscript reopen`
records the withdrawal.

**Prose scores are explainable arithmetic.** The six sub-scores of PRD §39.1 are computed from
counted observations with the formula written down in `FORMULAS`, reported under `--json`, and
documented in `docs/cli.md`. A sub-score whose input was not supplied is `null`, never `0`: "we
did not measure this" and "this text scores zero" are different statements, and only one of them
is true about a file with no manuscript context.

**Author profiles are counts, not embeddings.** `phdude authors learn` computes descriptive
statistics from approved samples — sentence-length mean and standard deviation, opening
diversity, paragraph density, transition rate, first-person rate, hedge rate, frequent
terminology — and writes them under `learned:` as plain numbers and word lists. A researcher can
read every field, disagree with one, and edit it. An embedding would be smaller, more accurate
about style, and completely unauditable; the whole design rests on a researcher being able to
check what PhDude concluded about them.

**No AI-detector score. Not now, not later.** PhDude does not compute one, does not accept one as
input, and does not target one. The guard is global and runs before command parsing: any option
whose name matches `/detect|humaniz/i` exits 3, on every command including ones that do not
exist. Option names only, so `--file notes-on-detection.md` and `phdude packs detect` still work.

## Consequences

- A researcher who wants a detector score gets a refusal and an explanation, on the CLI and in
  every doc. The reason is not squeamishness: detector scores are unreliable, they are biased
  against people writing in a second language, and optimizing for one teaches the tool to
  disguise text rather than improve it. A section that scores well on a detector while asserting
  a claim its evidence does not support is worse than the draft it replaced, because it now
  reads as though someone checked.
- Every finding is deterministic and reproducible from the text plus the workspace. Two runs
  agree, a golden test can pin the output, and a researcher can argue with a specific line rather
  than with a number.
- The rules are conservative by design, and they will still miss things and occasionally annoy.
  `in order to` and `in terms of` are demoted to `info` for exactly that reason. A lint nobody
  trusts costs more than the minute a false positive costs.
- The gates cannot check what the workspace does not record. A number that came from a cited
  paper and carries no marker is a `warn`, not a block, because refusing it would make citing
  anything painful.
- Field-specific epistemic norms reach the agent as prose in a pack's skill, not as a rule
  `gate-evidence` enforces. PRD §8's `writing.epistemic_norms` needs a schema key, a loader and a
  rule to land together; it is scheduled with venue adaptation in v0.6, and
  [docs/extending.md](../extending.md) says so rather than implying the hook exists.
- The cost of "the CLI is the only writer" is a round trip on every draft: the agent writes a
  file, calls the CLI, reads findings, edits the file, calls again. That is slower than editing
  the section in place, and it is the reason the audit trail is worth anything.

## Alternatives considered

**Let the agent edit `manuscript/*.md` and lint afterwards.** Simpler, faster, and the way most
tools do it. Rejected: a lint that runs after the write cannot refuse the write. The gates would
become advice, and advice loses to a deadline.

**Score the draft with a model instead of rules.** A model would catch far more than nine
patterns and would judge argument quality, which no count can. Rejected for this layer: the score
would not be reproducible, could not be argued with line by line, and would make the deterministic
core depend on a provider. The model is the agent's job, and the agent is already in the loop —
the skills tell it what to look for, and the gates check what can be checked.

**Store the voice profile as an embedding.** More faithful to how someone actually writes.
Rejected: unreadable, uncorrectable, and unversionable in a git workspace. See the decision above.

**Auto-approve a section whose gates come back clean.** Tempting, and wrong. Clean gates mean the
text does not contradict the workspace; they say nothing about whether the argument is any good.
That judgment is the researcher's, and PRD §3.4 puts it behind a Decision for the same reason
`canonical` is behind one.

**Ship an AI-detector score but never optimize for it.** Rejected as unstable. A number a tool
prints is a number users will try to improve, and the first feature request would be a flag to
improve it. The refusal is cheaper to hold than the boundary.

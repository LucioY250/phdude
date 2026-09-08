# 0011 — Research Health: the formulas, and what the score is never allowed to be

**Status:** accepted
**Date:** 2026-09-08

## Context

A researcher two years into a thesis cannot see the shape of their own project any more. They
know the last thing they touched. They do not know that four of six questions have no method
behind them, that the literature search on the central question ran eighteen months ago, or that
the claim the whole discussion rests on is supported by one weak excerpt. PRD §39 asks for a
score that makes that shape visible.

A score is also the most dangerous thing PhDude can hand anybody. Any single number invites two
failures. The first is that it gets optimized instead of read: a researcher who learns that
declaring `limitations` raises Methodological Integrity will declare limitations, whether or not
they thought about them. The second is worse — a number nobody can re-derive is an oracle, and
an oracle is exactly what a research tool must not be. The whole point of PhDude is that the
researcher decides; a verdict they cannot argue with takes that away.

And there is a specific number that must never appear here. "How good is this writing" has a
cheap, popular, worthless proxy — an AI-detector or "humanity" score — and PRD §30c names
optimizing for it a prohibited goal. A health score is precisely the surface where somebody
would try to add one.

## Decision

**Eight dimensions, each computed by a pure function of the workspace snapshot**, with no
clock, no network and no model in the loop. `src/domain/health.js` takes the snapshot and the
policy and returns the report; the application layer only assembles the inputs. The same
workspace scores the same on any machine, on any day, at any hour.

| Dimension | Formula |
|---|---|
| Literature Coverage | Mean of three shares of the research questions: those with a `supported` or `canonical` claim, those with a source behind them (through a claim's evidence), and those whose search is not stale. |
| Evidence Strength | The mean claim-state score (`canonical` 100, `supported` 80, `candidate` 40, `disputed` 20, `rejected` 0) times the evidence strength factor: the mean of `strong` 1, `moderate` 0.75, `weak` and `unknown` 0.5 over every evidence item. |
| Methodological Integrity | Mean of the share of questions that have a method and the share of methods that declare `limitations`, minus 20 per open `methodology` review. |
| Citation Quality | 100 minus 10 per citation fault: every `cite check` finding that fails the check, plus every open `citation` review. |
| Freshness | 100 minus the share of research questions whose search has gone stale. |
| Reproducibility | The share of declared analyses, tables and figures that `repro check` calls `up-to-date`. |
| Consistency | 100 minus 25 per open fact conflict and 25 per disputed claim pair. |
| Academic Prose Quality | The mean of the section prose reports' aggregate scores. |

Every dimension is clamped to 0–100 and rounded to an integer, so a penalty can never drive a
score negative and a stack of them can never be read as a debt.

**A dimension the workspace cannot answer for scores `null`, not 100.** This is the ruling that
does the most work. A workspace with no declared analysis has not proved it is reproducible; a
workspace with no manuscript has not written well. Scoring either 100 would let an empty project
outrank a real one, which is the exact failure a health score exists to prevent. `null` prints
as `n/a` and is left out of the overall entirely.

Two readings follow from it. Evidence Strength scores **0**, not `null`, when claims are recorded
and no evidence is: the states were asserted and nothing stands behind them, which is a finding,
not an absence. And `unknown` evidence strength is scored with `weak`, because a strength the
researcher never assessed must not read as one they did.

**`uncited-source` costs nothing.** It is the one `cite check` finding that never fails `ok` —
it is a gap in the argument, which `phdude gaps` already raises, not a fault in the registry.
Charging for it would put every honest workspace with a reading list near zero. It is still
printed under Citation Quality, at no cost, so nobody has to wonder whether it was seen.

**The overall is a weighted mean over the dimensions that scored**, with the weights in
`health.weights` in the research policy, defaulting to 1 each and documented in
`defaults/research-policy.yaml`. A field weights its own priorities: a theoretical thesis can
weight Reproducibility to 0 and a systematic review can weight Literature Coverage to 3. A
weight that is not a number at or above zero falls back to 1 rather than poisoning the mean.

**Every number is printed with the observations behind it**, naming the ids that produced it.
The score is an argument the researcher can check, and disagree with, line by line.

**The score is computed on read.** `reports/health.yaml` exists only because `--trend` needs a
baseline: `--save` writes the latest score there and records one `health` event, and each save
replaces the last. There is no history file, so the score can never quietly become the record.

**There is no detector, "humanity" or AI score, on this command or any other.** The CLI refuses
any flag whose name contains `detect`, `humaniz`, `humanity` or `ai-score` with exit 3, before
the command is reached (`src/adapters/cli/args.js`). Academic Prose Quality reads the same
deterministic lint `phdude prose` reports — sentence length, hedging, vague-literature phrases,
unresolved markers — and nothing else.

## Consequences

A researcher gets a shape they can act on: the weakest dimension names the ids behind it and the
command that moves it. `phdude ready` composes health thresholds into the submission verdict, so
the same numbers that explain the project also gate it.

The formulas are arbitrary in the way any index is arbitrary — the 25-point conflict penalty is
a judgement, not a measurement. That is survivable because the observations are printed: a
researcher who disagrees with the weight of a penalty can still read the two conflicts it came
from. It would not be survivable if the number arrived alone.

Adding a dimension means changing `DIMENSIONS` in `src/domain/health.js`, its default weight, the
table above, the `docs/cli.md` section and the golden — deliberately more friction than adding a
gap kind, because a dimension changes every project's score at once.

Weights are a real lever and a real risk: a workspace can weight its way to a better number.
That is acceptable because the weights live in a committed policy file, in the open, next to the
score they produced.

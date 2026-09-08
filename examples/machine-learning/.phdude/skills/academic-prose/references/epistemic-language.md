# Epistemic language

Which verb a sentence may use is decided by the state of the claim it asserts and the strength
of the evidence behind it - not by how confident the sentence sounds better (PRD §3.13, §29.2).
A sentence must never claim more certainty than its evidence supports. `gate-evidence` enforces
this; this table is what it enforces.

## Verb by evidence strength

| Claim state / evidence | Allowed verbs | Forbidden |
| --- | --- | --- |
| `candidate`, or evidence `weak` | suggests, indicates, is consistent with, points toward, may reflect, appears to | shows, demonstrates, proves, establishes, confirms |
| `supported`, evidence `moderate` or `strong` | shows, provides evidence for, is associated with, supports, reports | demonstrates, proves, causes (without a design that supports it) |
| `canonical` | demonstrates, establishes, shows | proves (reserve for mathematics) |
| `disputed` | name both sides explicitly: "X reports …, while Y reports …" | any verb that picks a side silently |
| `rejected` | do not assert the claim at all | every verb |

## Correlation is never causation

An association is written as an association, whatever the effect size. Use "is associated with",
"co-occurs with", "predicts" (statistically), "is higher among". Reserve "causes", "leads to",
"results in", "drives" and "produces" for a design that can support them: a randomized
assignment, a credible instrument, or a mechanism the workspace records as a Method.

A `<!-- result: -->` marker on a correlational number does not license a causal verb.

## Hedging is a claim, not decoration

One hedge is a finding at its real strength. Three in a sentence is no finding at all.

> The intervention may possibly indicate that engagement could improve somewhat.

says nothing. Choose the strength the evidence supports and say it once:

> The intervention is associated with a 12-point rise in engagement [@lopez2023].

Removing a hedge during revision changes the claim, so the meaning-preservation check treats it
as a change of meaning and blocks it. Adding one does the same.

## Numbers

A numeral of two digits or more needs a `<!-- fact: FACT-… -->` or `<!-- result: RESULT-… -->`
marker, or a citation in the same sentence. If neither exists, the number is not yet part of the
workspace: add it with `phdude add fact` (or record the result) before it reaches the prose.

## Novelty

"Novel", "first", "unprecedented" and "state-of-the-art" are claims about the literature, and
they need the same evidence as any other claim: a search that found nothing, recorded as a
Search, or sources that say so. Without one, drop the word.

## Verbos en español

| Estado / evidencia | Verbos permitidos | Prohibidos |
| --- | --- | --- |
| `candidate`, evidencia `weak` | sugiere, indica, es compatible con, apunta a, podría reflejar | muestra, demuestra, prueba, confirma |
| `supported`, evidencia `moderate` o `strong` | muestra, aporta evidencia de, se asocia con, respalda | demuestra, prueba, causa |
| `canonical` | demuestra, establece, muestra | prueba |
| `disputed` | nombrar ambas posturas | cualquier verbo que elija una en silencio |
| `rejected` | no afirmar la claim | todos |

"Se asocia con" no es "causa". La distinción vale igual en español.

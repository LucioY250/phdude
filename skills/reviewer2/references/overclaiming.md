# Overclaiming

## The verb has to match the state

| Claim state | The prose may say | It may not say |
| --- | --- | --- |
| `candidate` | suggests, indicates, is consistent with, points toward, may reflect | shows, demonstrates, proves, establishes |
| `supported` | shows, provides evidence for, is associated with, supports, reports | demonstrates, proves, causes |
| `canonical` | demonstrates, establishes, shows | proves (reserve it for mathematics) |
| `disputed` | name both sides: "X reports …, while Y reports …" | any verb that picks a side silently |
| `rejected` | nothing; do not assert it | every verb |

The gate in `phdude manuscript submit` checks this mechanically for marked claims. What it cannot
check, and you can, is a sentence that carries a claim without a marker at all.

## The other five ways a sentence claims too much

1. **Correlation stated as cause.** "Adoption increases revenue" over a cross-sectional
   association. The finding names the claim and the design that cannot support it.
2. **A single study stated as settled.** "It is established that …" behind one unreplicated
   result. `canonical` is a state a decision confers, not an adjective.
3. **The population swap.** Measured on one group, stated about a larger one, with no sentence in
   between doing the work.
4. **The mechanism nobody measured.** The result is an association; the sentence explains *why*,
   with an explanation the study never tested.
5. **Absence read as evidence.** A null result reported as "no effect" when the study was never
   powered to find one.

## What a good finding looks like

Name the id, quote the wording, say what the record supports instead, and suggest the smaller
sentence:

> `CLAIM-…` is worded "adoption drives retention" on `EVID-…`, a cross-sectional association at
> one firm. The record supports "adoption is associated with retention in this sample". Either
> narrow the wording or record what licenses the causal step.

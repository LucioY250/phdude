# Voice matching

An author's voice is a set of measurable habits, not a mood. PhDude records the measurable part
in `authors/<id>.yaml` under `learned:`, and the writing context carries it into every draft.

## What is measured

| Field | What it says | How to use it |
| --- | --- | --- |
| Mean sentence length | How long this author's sentences run | Write to the mean, not to a style guide's 20 words |
| Sentence-length SD | How much they vary | A low SD is a real habit; do not "fix" it |
| Opening diversity | How often two sentences start the same way | Match it; forcing more variety than the author has reads as someone else |
| Transition rate | How often a sentence opens on a connective | Match it |
| First-person rate | How often they write "we" | Match it, and stay consistent within a section |
| Paragraph density | Sentences per paragraph | Match it |
| Preserved terminology | The terms this author uses for their own concepts | Use exactly these words, never a synonym |
| Avoided terminology | The words this author does not use | Never introduce one |

## Matching is not imitation

Match the statistics and the terminology. Do not attempt to reproduce a personality, a sense of
humour or a rhetorical signature: the measurable habits are what a voice profile can honestly
carry, and the rest would be invention.

When the profile and the evidence disagree, the evidence wins. An author who habitually writes
"demonstrates" does not get to write it about a candidate claim.

## Preserved terminology is not negotiable

If the profile preserves "adoption lag", write "adoption lag". Not "adoption delay", not "lag in
adoption". A researcher's term for their own construct is part of the argument: swapping it makes
two papers look like they are about different things.

## Spanish and first person

Spanish drops the subject pronoun, so a first-person verb often carries no pronoun at all. The
measured first-person rate for a Spanish text is comparable with other Spanish texts, never with
an English one. Do not "correct" a Spanish profile toward an English rate.

## No profile

When no profile is recorded, the context says so. Write plainly in the manuscript language:
consistent sentence length, no affectation, no borrowed voice. Writing in an invented voice is
worse than writing in none.

## What the gate checks

`gate-voice` compares the draft's statistics with the profile's learned fields within the
policy's tolerances and warns on a deviation; a term from `terminology.avoid` warns; preserved
terminology the claims use but the prose does not is reported as `info`. It never blocks: voice
is a matter of degree, and the researcher is the authority on their own.

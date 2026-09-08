# Academic style

What separates academic prose from prose that merely sounds academic. Every rule here is one a
reader can check against the text in front of them.

## The sentence carries one claim

A sentence that carries three claims hides two of them. Split it, and let each claim take the
verb its evidence allows.

Rather than:

> The intervention, which was delivered across four campuses and involved both cohorts,
> substantially improved engagement and also suggests that delivery mode may matter.

write:

> The intervention was delivered to both cohorts across four campuses. Engagement rose by 12
> points <!-- result: RESULT-… -->. Whether delivery mode explains the difference is not settled
> by this design.

## Specificity is a number, a name or a locator

"Several studies" names nobody. "A large sample" measures nothing. Every concrete detail resolves
to something the workspace records, or it does not belong in the sentence.

| Instead of | Write |
| --- | --- |
| Recent studies have shown | Lopez and Iyer report [@lopez2023] |
| A significant improvement | A 12-point rise (95% CI 4-20) <!-- result: RESULT-… --> |
| A large sample of participants | 312 undergraduates <!-- fact: FACT-… --> |
| The literature suggests | Three of the four surveys report [@a; @b; @c] |

## Paragraphs argue; they do not enumerate

A paragraph makes one move: it states a position, gives the evidence, and says what follows. A
paragraph that lists three parallel items with the same opening is a table wearing prose.

If the content really is a list, make it a list. If it is an argument, make each sentence earn
its place in the argument.

## Connectives mark real turns

"However" means the next sentence contradicts the last one. "Therefore" means it follows from
it. When the connective is decorative, the reader learns to skip it, and the one that mattered
gets skipped too. One connective per real turn; none anywhere else.

## Restraint reads as confidence

"Novel", "crucial", "robust" and "significant" are claims about the literature or about a
statistic. Each needs the same evidence as any other claim: a recorded search that found nothing
prior, or a number with its interval. Without one, the adjective is doing the work the evidence
should be doing, and a reader who knows the field will notice.

"Significant" additionally means something specific in a statistical context. Do not use it
loosely in a paper that also uses it precisely.

## The methods paragraph is a record, not a summary

Take the design, sampling, instruments, analysis and limitations from the `METH-` object. If the
prose and the record disagree, the record is right and the prose is a bug.

## Voice

First person is not unacademic; it is a discipline convention. Match the author profile and the
venue, keep it consistent within a section, and never switch mid-paragraph to sound more formal.

## The test

Read the paragraph and ask: could a reader who disagrees with me find the thing to disagree
with? If the paragraph contains nothing specific enough to dispute, it contains nothing.

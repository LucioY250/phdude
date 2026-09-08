---
name: write
description: Draft a manuscript section from the writing context PhDude assembles - the section's claims, their evidence, the citation keys and the verb each claim state allows - and submit it through the gates.
phdude:
  version: 1
  reads:
    [
      manuscript/**,
      knowledge/claims/**,
      knowledge/evidence/**,
      knowledge/sources/**,
      authors/**,
      .phdude/cache/writing/**,
      .phdude/writing-policy.yaml,
    ]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# Write

Follow `[[phdude-core]]` and `[[academic-prose]]`. This skill is the drafting loop: how to ask
PhDude for a section's context, what that context contains, and what you owe back.

## The loop

```
phdude write introduction --json
```

It writes `.phdude/cache/writing/introduction/context.md` and prints the path, what went into
the context, what did not fit the budget, and the draft contract. Read the context file. Do not
read the whole manuscript, the whole knowledge base, or a cached PDF "for background": the
context is the budget, and PhDude already spent it in priority order for you (PRD §70).

Write the draft to a scratch file. Then:

```
phdude manuscript submit introduction --file draft.md
```

The gates run there. A blocking finding means nothing was written: fix the draft and submit it
again. Never edit a file under `manuscript/` yourself, and never work around a gate.

## What the context carries

| Section | What to do with it |
| --- | --- |
| Task instruction | The section's purpose, the manuscript title and language. This is what the section is for; write that, not a summary of the project. |
| Canonical project facts | The title, the research questions, the methods, the established values. Take the methodology from here, never from memory. |
| The section's claims | One block per claim: its state, the marker to assert it with, and its strongest evidence with the locator and the citation key. |
| Citation keys available | The only keys you may write. |
| Writing policy | The workspace's tone and what it asks you to avoid. |
| Author voice | The learned statistics and the terminology to preserve or avoid, or a line saying no profile is recorded. |
| Verb table | Which verb each claim state allows, filtered to the states this section asserts. |

`truncated` in the output names what the budget left out. If a claim you need is on that list,
raise `--budget` rather than guessing what it said.

## The draft contract

1. Markdown for that section only. No title page, no front matter, no other section.
2. Cite as `[@bibkey]`. Pandoc forms work: `[@a; @b]`, `[@a, p. 3]`, `[see @a]`. Only the keys
   the context lists exist.
3. One `<!-- claim: CLAIM-… -->` in every paragraph that asserts a claim.
4. Every numeral of two digits or more carries `<!-- fact: FACT-… -->` or
   `<!-- result: RESULT-… -->`, or a citation in the same sentence.
5. The verb matches the claim's state and its evidence strength. A claim resting on weak
   evidence may not "show" anything, whatever its state says.
6. Nothing the context does not carry. No new source, no new number, no finding you inferred.
7. A figure goes in as `![alt text](figures/out/<name>.svg)`, and a built table as a link **on a
   line of its own**: `[Table 1](tables/out/<name>.md)`. `phdude build` copies the figure in
   beside the document and replaces that line with the table itself; the same link inside a
   sentence stays a reference to the file, which is what you want when the prose points at a
   table rather than showing it. Only a path a `FIG-` or `TABLE-` record has actually built
   exists — `phdude figure list` and `phdude table list` say which.

## When the context is not enough

Say so and stop. A section with no claims attached is not a section to improvise: it is a
research gap, and the answer is `phdude gaps`, not better prose. If you need a number the
workspace does not record, ask the researcher to record it (`phdude add fact`) first.

## Writing to a venue

When `manuscript.yaml` names a `target_profile`, the venue's word limit for the section is a
gate: `phdude manuscript submit` refuses a section over it, and the refusal names the limit.
`phdude profile check` reports every venue rule at once — required sections, order, word counts,
figure formats — and it is what to read before saying a section is done.

A section written for one venue rarely fits another. `phdude adapt --to <venue>` says what the
move would cost before anything is changed; follow `[[venue-adapt]]` when the work is going
somewhere else.

## Revising

Use `[[academic-prose]]` and `phdude deslop <section>`. A revision preserves every claim,
citation, number and negation; the meaning gate blocks one that does not.

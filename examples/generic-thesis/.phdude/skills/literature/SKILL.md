---
name: literature
description: Verify the citation registry before writing, and read the literature matrix and research gaps it feeds.
phdude:
  version: 1
  reads: [knowledge/**, research/**, decisions/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# Literature

Follow `[[phdude-core]]`: this skill is read-only, and every source is only as trustworthy as
the evidence and provenance behind it.

## Citations

**Never invent a source, an author, a year, a DOI, or a quote.** If a source is not recorded
in the workspace, say so and ask the researcher — do not fabricate one to fill a gap (PRD
S37, S3.13 "never fabricate").

Every source needs a `title`, at least one `author`, and a `year` before it can be cited with
confidence; add the DOI (`identifiers.doi`, or top-level `doi`) whenever you know it — it is
how a reader verifies the source independently:

```
phdude add source --json '{"title":"…","authors":["…"],"year":2024,"type":"article","identifiers":{"doi":"10.1234/xyz"},"artifacts":["ART-…"]}'
```

`phdude cite list --json` shows every source with its derived or explicit `bibkey` and how many
evidence items cite it (`cited_by`). Report the bibkey and `cited_by` alongside a source, not
just its title — a source with `cited_by: 0` is recorded but not yet used anywhere.

### Run `phdude cite check` before any writing task

```
phdude cite check --json
```

Run this before drafting anything that cites the literature, and again before `phdude cite
export`. It never fails on `uncited-source` alone — that finding is informational, reported so
you know what is recorded but not yet drawn on, not something to fix by itself. Every other
finding kind must be resolved first (the command exits 2 while any of them remain):

| Finding kind | What it means | How to fix it |
| --- | --- | --- |
| `evidence-missing-source` | An evidence item's `source` id does not exist. | Find the right id with `phdude knowledge list`, then add a corrected evidence item citing it — an evidence item's `source` cannot be edited in place. |
| `invalid-doi` | A DOI does not match `^10\.\d{4,9}/\S+$`. | A DOI is not part of a source's identity, so correct it in place: `phdude edit SRC-… --json '{"identifiers":{"doi":"10.…"}}'`, or drop it if it was never a real DOI. |
| `missing-field` | A source is missing `title`, `authors`, or `year`. | `authors` is editable in place (`phdude edit SRC-… --json '{"authors":["…"]}'`). `title` and `year` are the source's identity, so correcting either means adding a corrected source and leaving the original as the history of what was believed. |
| `duplicate-source` | Two or more sources share the same normalized `title` + `year`. | Confirm with the researcher which one is canonical, then stop citing the other; do not silently pick one yourself. |
| `duplicate-bibkey` | Two or more sources declare the same explicit `bibkey`. | Give each a distinct `bibkey`, or drop the explicit one so it is derived instead. |

`phdude cite export --format bibtex|csl-json` writes `references.bib` / `references.json` at
the workspace root. It is a derived artifact, not knowledge — it records no event, and citing
it is never a substitute for the SRC id itself. Re-run `check` after any change to sources or
evidence rather than trusting a stale export.

## Matrix and gaps

### Reading the matrix

```
phdude matrix --json
```

One row per source, ordered newest first: which research questions its evidence reaches
(evidence → claim → question), which claims reach it that way, the strongest evidence strength
citing it directly, the facts extracted from its own artifacts, and any pack-declared method
tags. **A row with an empty `questions` array means the source was cited but never used in a
claim** — it is recorded, and evidence may even quote it, but nothing built on that evidence
yet. Report that distinction, not just the row's title: a source used across three questions and
a source sitting unused both belong in the summary, for different reasons.

`--question RQ-n` filters the matrix to the sources that actually reach one research question —
use it before writing a section to see exactly what backs it.

### Working a gaps list

```
phdude gaps --json
```

Returns `{ gaps, counts }`, each gap `{ kind, id, why, command, severity }`, already sorted
high → medium → low. Work it in that order:

1. Start with every `high` gap — an unaddressed research question, a claim with no evidence at
   all, an open conflict, or a disputed claim pair — before touching `medium` or `low` ones.
2. For a gap whose fix is recording evidence or a claim, run the `command` the gap already
   gives you (or adapt it with the real ids/excerpt) rather than composing one from scratch.
3. **Never invent a source to close a gap.** If a gap can only be closed by evidence from a
   source the workspace does not have (e.g. a `question-without-claims` gap with nothing in the
   literature yet), say so plainly and describe what the researcher should look for — a method,
   a population, a date range — instead of fabricating a citation to make the gap disappear.
4. An `uncited-source` or `artifact-unmined` gap is often fine to leave open for a while (low
   severity) — note it, do not treat it as urgent.

## Freshness

```
phdude freshness --json
```

Read-only, and it never touches the network. Returns `{ questions, sources, summary }`: per
research question the last search, `daysAgo`, whether the policy calls that `stale`, and how
many searches it has; per source its `year` and `age` in years; then the counts.

Read it as two different problems, not one number:

1. **`lastSearch: null` — never searched.** There is no literature behind that question at all.
   This is the more urgent case, not the exempt one. The fix is a first search
   (`phdude research "…" --question RQ-n`), which needs the network policy open — report that
   and ask, do not pass `--allow-network` yourself (`[[phdude-core]]`).
2. **`stale: true` with a date — the search has aged out.** The fix is
   `phdude research-fresh --question RQ-n`, which re-runs it exactly as it ran before and
   reports only what is new. See `[[research]]`.

The same two show up in `phdude gaps` as the kinds `question-never-searched` and `stale-search`,
and in `phdude next` as the `stale-search` rule. `stale-search` is low severity.
`question-never-searched` is medium while the policy has the network open and low while it is
closed — a workspace that closed the network has decided where its literature comes from, and
both reports then recommend opening the policy first rather than a command that would refuse.

Source `age` is context, not a verdict: a 2019 paper is not stale because it is old, it is the
foundational reference for half the field. Report the median and the oldest so the researcher
can see the shape of the bibliography, and never recommend dropping a source on age alone.

## Reporting to the researcher

Report the matrix, the gaps and the freshness together, in 10 lines or fewer: how many sources
are recorded and how many are actually used in a claim, the top 1-2 high-severity gaps with
their `why`, any question with no literature behind it at all, and the one action you recommend
next (usually the top gap's `command`, or `phdude next` if something else outranks it). Skip
anything the researcher did not ask about — this is a status update, not the full report.

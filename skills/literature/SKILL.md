---
name: literature
description: Verify the citation registry before writing, and read the literature matrix and research gaps it feeds.
phdude:
  version: 1
  reads: [knowledge/sources/**, knowledge/evidence/**, knowledge/claims/**]
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
| `invalid-doi` | A DOI does not match `^10\.\d{4,9}/\S+$`. | Correct the DOI (`identifiers.doi` or `doi`) on a re-added source, or drop it if it was never a real DOI. |
| `missing-field` | A source is missing `title`, `authors`, or `year`. | Add a corrected source with the field set (see above) — a source's id is derived from `title` and `year`, so correcting either mints a new record. |
| `duplicate-source` | Two or more sources share the same normalized `title` + `year`. | Confirm with the researcher which one is canonical, then stop citing the other; do not silently pick one yourself. |
| `duplicate-bibkey` | Two or more sources declare the same explicit `bibkey`. | Give each a distinct `bibkey`, or drop the explicit one so it is derived instead. |

`phdude cite export --format bibtex|csl-json` writes `references.bib` / `references.json` at
the workspace root. It is a derived artifact, not knowledge — it records no event, and citing
it is never a substitute for the SRC id itself. Re-run `check` after any change to sources or
evidence rather than trusting a stale export.

## Matrix and gaps

_(added by the literature matrix and research gaps work — `phdude matrix`, `phdude gaps`)_

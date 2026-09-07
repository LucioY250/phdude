---
name: bootstrap
description: Ingest a messy research workspace, classify its artifacts, and extract the first sources, facts, and candidate claims.
phdude:
  version: 1
  reads: [sources/**, .phdude/cache/**, knowledge/artifacts/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# Bootstrap

Follow `[[phdude-core]]` throughout: everything you add is a `candidate` until the researcher
reviews it, and you write only via `phdude add`.

## 1. Ingest

```
phdude ingest --json
```

This inventories `sources/`, hashes and extracts text, and caches it under
`.phdude/cache/ART-<id>/`. Read `inventory` in the JSON result for every artifact in the
workspace with its `id`, `path`, `kind`, `role` and `extracted.status`. (`artifacts` lists
only what this run changed, and is empty when nothing did, so do not work from it.)

## 2. Classify unknown artifacts

For every artifact with `role: unknown`, read the first ~60 lines of
`.phdude/cache/ART-<id>/text.md` and decide its role (`paper`, `thesis-draft`, `presentation`,
`dataset`, `questionnaire`, `notes`, `report`). Then:

```
phdude add artifact-role --json '{"id":"ART-0123456789","role":"paper"}'
```

## 3. Extract from papers, theses, and reports

For each artifact with role `paper`, `thesis-draft`, or `report`, read
`.phdude/cache/ART-<id>/sections/*.md` one section at a time (never the whole `text.md` unless
it is short) and extract:

**Sources** — the bibliographic record for the artifact itself, or works it cites:

```
phdude add source --json '{"title":"...","authors":["..."],"year":2023,"venue":"...","doi":"","url":"","type":"article","artifacts":["ART-0123456789"]}'
```

**Facts** — sample size, study period, country, instruments, tools, number of interviews, and
similar project facts, each with a locator:

```
phdude add fact --json '{"key":"sample_size","value":142,"from":{"artifact":"ART-0123456789","locator":"p. 12"}}'
```

**Research questions** — a fresh workspace has none, and claims may reference them, so propose
1-3 to the researcher based on what you have read. Once they confirm, record each one:

```
phdude add question --json '{"text":"...","objectives":["..."]}'
```

This returns an id such as `RQ-1`; only use ids `add question` actually returned, never a guess.

**Evidence, then claims that cite it** — never add a claim without evidence. `questions` is
optional on a claim: omit it, or reference the ids `add question` returned above.

```
phdude add evidence --json '{"source":"SRC-0123456789","locator":"p. 4, para 2","excerpt":"...","strength":"moderate"}'
phdude add claim --json '{"statement":"...","kind":"empirical","supported_by":["EVID-0123456789"]}'
```

`kind` is one of `literature | empirical | theoretical | methodological`. Re-adding the same
statement is a safe no-op (content-derived ids).

## 4. Close the loop

```
phdude packs detect --json
phdude status --json
phdude next --json
```

## 5. Summarize for the researcher

Finish with a summary of 10 lines or fewer covering: what the project is, what is known so far,
what conflicts exist (from `status`), and the single next step (from `next`). See `[[next]]`
for how to present it.

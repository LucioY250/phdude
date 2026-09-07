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
`.phdude/cache/ART-<id>/`. Read the JSON result for the list of artifacts and their
`extracted.status`.

## 2. Classify unknown artifacts

For every artifact with `role: unknown`, read the first ~60 lines of
`.phdude/cache/<ART-id>/text.md` and decide its role (`paper`, `thesis-draft`, `presentation`,
`dataset`, `questionnaire`, `notes`, `report`). Then:

```
phdude add artifact-role --json '{"id":"ART-xxxxxxxxxx","role":"paper"}'
```

## 3. Extract from papers, theses, and reports

For each artifact with role `paper`, `thesis-draft`, or `report`, read
`.phdude/cache/<ART-id>/sections/*.md` one section at a time (never the whole `text.md` unless
it is short) and extract:

**Sources** — the bibliographic record for the artifact itself, or works it cites:

```
phdude add source --json '{"title":"...","authors":["..."],"year":2023,"venue":"...","doi":"","url":"","type":"article","artifacts":["ART-xxxxxxxxxx"]}'
```

**Facts** — sample size, study period, country, instruments, tools, number of interviews, and
similar project facts, each with a locator:

```
phdude add fact --json '{"key":"sample_size","value":142,"from":{"artifact":"ART-xxxxxxxxxx","locator":"p. 12"}}'
```

**Evidence, then claims that cite it** — never add a claim without evidence:

```
phdude add evidence --json '{"source":"SRC-xxxxxxxxxx","locator":"p. 4, para 2","excerpt":"...","strength":"moderate"}'
phdude add claim --json '{"statement":"...","kind":"empirical","supported_by":["EVID-xxxxxxxxxx"],"questions":["RQ-1"]}'
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

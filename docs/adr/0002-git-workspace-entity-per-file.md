# 2. The research workspace is a git repository, one file per object

**Status:** Accepted (2026-09-07) — v0.1

## Context

A research project runs for years, across several people, and its history matters as much as
its current state: what was claimed, on what evidence, and when it changed (PRD §11, §13,
§82). The researcher owns the data outright, in a format readable without PhDude installed
(PRD §3.11). Concurrent edits are normal, and the researchers' merge tool is git.

## Decision

The workspace is a plain git repository of YAML and Markdown. Each canonical object is its
own file, named by its id, under a directory named for its type:
`knowledge/claims/CLAIM-3d035aa05b.yaml`, `decisions/DEC-da1a3616b6.yaml`, and so on.

- **No database and no single index file.** Every count, list and conflict report in `status`
  is derived on read by walking the directories.
- **Writes are atomic:** temp file in the same directory, then rename.
- **`.phdude/events.jsonl` is append-only** and holds one event per mutating command, so the
  audit trail survives even when git history is rewritten.
- **`.phdude/cache/` is disposable and gitignored,** rebuilt from `sources/` by `ingest`.

## Alternatives considered

- **SQLite.** Better queries, but it turns every collaboration into a binary merge conflict
  and hides the research from the researcher.
- **One large `knowledge.yaml`.** Every concurrent edit collides on one file, and the diff
  stops being readable.

## Consequences

- Two people adding different claims produce two new files and merge cleanly. Editing the
  same claim conflicts on that one file, which is the honest outcome.
- Reads scale with the object count. An index can be added later without changing the
  on-disk contract.
- Content-derived ids ([ADR 3](0003-content-derived-ids.md)) make this merge-safe: the same
  claim added on two branches is one file, not two.

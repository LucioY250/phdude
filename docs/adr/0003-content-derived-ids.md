# 3. Object ids are derived from content, not allocated

**Status:** Accepted (2026-09-07) — v0.1

## Context

Ids must survive the two things a research workspace does constantly: re-running the same
extraction, and merging branches. Counters and UUIDs fail both. Re-running the bootstrap
skill would mint `CLAIM-2` for a statement already stored as `CLAIM-1` (PRD §62, §66).

## Decision

Ids are `<PREFIX>-<first 10 hex of sha256>` over normalized content.

- **Artifact:** sha256 of the file bytes; two copies of a PDF are one artifact, two `paths[]`.
- **Claim / Evidence / Fact / Source / Result / Decision:** sha256 of the type plus the
  normalized primary text (statement, excerpt, `key + value + source artifact`,
  `title + year`, summary, title).
- **A Fact's identity includes its source artifact.** Two artifacts reporting
  `sample_size = 142` and `sample_size = 118` are deliberately two Fact records: that pair
  *is* the contradiction `status` has to report (PRD §38).
- **Research questions and hypotheses stay sequential** (`RQ-1`, `H-2`): few, human-facing,
  and a researcher must be able to say "RQ2" out loud.

Adding the same object twice is a no-op that returns the existing record.

## Alternatives considered

- **UUIDs or counters everywhere.** Merge-hostile, and idempotent extraction then needs a
  separate dedup index.
- **Content ids for RQ/H too.** Rejected: the objects a researcher names out loud deserve
  readable ids.

## Consequences

- Re-running `ingest` or the bootstrap skill is safe and cheap; nothing is duplicated.
- Editing a statement changes the id. Intended: a different statement is a different claim,
  and the old one is superseded through a Decision.
- Sequential `RQ`/`H` ids can collide across branches; duplicates are detected on read and
  reported as warnings, never merged silently.

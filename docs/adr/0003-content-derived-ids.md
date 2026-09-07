# 3. Object ids are derived from content, not allocated

**Status:** Accepted (2026-09-07) — v0.1

## Context

Ids must survive the two things a research workspace does constantly: re-running the same
extraction, and merging branches. Counters and UUIDs fail both. Re-running the bootstrap
skill would mint `CLAIM-2` for a statement already stored as `CLAIM-1` (PRD §62, §66).

## Decision

Ids are `<PREFIX>-<first 10 hex of sha256>` over normalized content. What gets hashed is the
type plus the fields that make the object the object it is:

| Object | Id material |
|---|---|
| Artifact | the file bytes |
| Claim | `statement` |
| Evidence | `source`, `locator`, `excerpt` |
| Fact | `key`, `value`, `from.artifact` |
| Source | `title`, `year` |
| Result | `summary` |
| Decision | `title`, `rationale`, `affects` (sorted), `change` (keys sorted) |

- **An Artifact is its bytes.** Two copies of a PDF are one artifact with two `paths[]`.
- **A Fact's identity includes its source artifact.** Two artifacts reporting
  `sample_size = 142` and `sample_size = 118` are deliberately two Fact records: that pair
  *is* the contradiction `status` has to report (PRD §38).
- **Evidence identity includes its source and locator.** The same sentence attributed to a
  different work or a different page is different evidence, and a claim citing it must get
  the provenance it was given.
- **A Decision's identity is the whole proposal, not its title.** Two proposals sharing a
  title but differing in rationale, `affects` or `change` are two proposals; without this a
  re-proposal is silently swallowed and the agent sees an approval nobody granted. Sorting
  `affects` and the `change` keys keeps the id independent of argument order.
- **Research questions and hypotheses stay sequential** (`RQ-1`, `H-2`): few, human-facing,
  and a researcher must be able to say "RQ2" out loud. They deduplicate on normalized text
  instead, so re-running the bootstrap skill does not mint a second `RQ` for a question
  already recorded.

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

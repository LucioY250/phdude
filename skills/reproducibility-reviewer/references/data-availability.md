# Data availability

The question is not "is it open". It is: could a second researcher tell whether they had the same
thing the claims rest on?

## Registered, not described

- Every dataset behind a claim is a `DATASET-` record: a path under `data/`, a hash of its bytes,
  a format, and a column profile. A dataset that exists only as a sentence in the methods is a
  `major` finding, and the fix is `phdude data add <path>`.
- The hash is the identity. A file edited after registration is a *different* dataset, and the
  record that says otherwise is wrong; `repro check` reports it as `bytes changed on disk`.
- A dataset marked `sensitive: true` keeps cell values out of its profile. That is a correct
  restriction, not a gap — do not report it as one.

## What the record should say

| Field | Why a reviewer wants it |
| --- | --- |
| `description` | What the rows are, in one sentence. A profile shows types; it does not say what a row is. |
| `license` | Whether the data can be redistributed with the paper at all. |
| `sensitive` | Whether cell values may be printed. |
| `profile.rows`, `profile.columns` | Whether the analysis's assumptions about shape hold. |
| `versions_of` | Which earlier file this one replaces, and therefore which results are stale. |

## Provenance gaps worth a finding

- A claim whose evidence cites an artifact that was never ingested.
- A `RESULT-` whose `from` names an analysis that no longer exists.
- A dataset with no `versions_of` link where the record clearly shows a second version — the
  chain from data to claim breaks silently.
- Derived data — a cleaned or joined file — registered with no analysis that produces it. The
  cleaning is then a step nobody can repeat.

## What not to report

- The absence of a public repository link. That is a venue requirement, and `phdude profile
  check` is where it belongs.
- Anything about data you would have to leave the workspace to inspect.

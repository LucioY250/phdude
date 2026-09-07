# ADR 0006: Workspace versioning and migrations

**Status:** accepted (v0.2)

## Context

v0.2 adds fields to existing objects (`provenance` and `contradicts` on claims, `provenance` on
evidence). A v0.1 workspace is a directory of YAML files on someone's disk; PhDude cannot ship a
database migration, and it cannot ask every reader to handle both shapes forever. Object schemas
carry a `version`, but bumping it per object would mean a breaking change for every additive
field and a per-type compatibility matrix nobody can hold in their head.

## Decision

Version the **workspace**, not the object. `phdude.yaml` gains an optional `workspace_version`
integer; a workspace without it is version 1. `CURRENT_WORKSPACE_VERSION` lives in
`src/domain/versioning.js` and is 2 in v0.2.

Migration steps are modules in the package's `migrations/` directory, one file per step
(`0001-workspace-v2.mjs`), each exporting `{ from, to, describe(), preview(store), apply(store) }`.
`src/application/migrate.js` discovers them, plans the chain from the workspace's version to the
current one, and runs each step through the injected store, appending one `migrate` event per
step. Steps are deterministic and idempotent: re-applying one changes nothing.

`phdude migrate` refuses to run on a dirty git tree unless `--force`, because git is the only
undo. `--dry-run` writes nothing and lists the files each step would rewrite; it stays available
on a dirty tree, since it is how a researcher decides whether the commit is worth making.

Reads keep working on an out-of-date workspace and report `workspace needs migration (1 → 2)`;
writes stop at `assertUpToDate` in `src/application/guard.js` with that message and the hint
`run phdude migrate`.

## Alternatives considered

- **Per-object schema versions.** Rejected: additive fields would force breaking bumps, and every
  reader would need a per-type compatibility matrix.
- **Read-time defaulting, no migration.** Rejected: the defaults would live in every reader
  forever, and the files on disk would never tell the truth about their own shape.
- **Auto-migrate on first write.** Rejected: a silent in-place rewrite of a researcher's
  workspace is exactly the surprise PhDude's CLI-only write path exists to prevent.

## Consequences

- Adding a step is adding a file; nothing else changes.
- v0.2 keeps every object schema at `version: 1`; new fields are optional and backfilled by 0001.
- A workspace newer than the installed PhDude is refused rather than silently downgraded: the
  migration chain fails with a `VALIDATION` error, and every other write stops at the guard with
  a `USAGE` error hinting `upgrade phdude`. Reads warn, as they do for an older workspace.
- Migrations can only use the `Store` port, so they cannot reach past the workspace.

# Migrating a workspace

A PhDude workspace outlives the PhDude that made it. This page is what happens in between: how
the workspace is versioned, what each upgrade step actually does to your files, and — if you are
contributing — how to write the next one.

The short version: run `phdude migrate` once after upgrading PhDude, on a clean git tree.

- [The one number that matters](#the-one-number-that-matters)
- [Upgrading a workspace](#upgrading-a-workspace)
- [What each step does](#what-each-step-does)
- [What a migration promises](#what-a-migration-promises)
- [When it goes wrong](#when-it-goes-wrong)
- [Writing a migration](#writing-a-migration)

## The one number that matters

`phdude.yaml` carries `workspace_version`. Every object schema stays at `version: 1` and every
field added since 0.1 is optional or has a default, so a reader has exactly one question to ask
before it trusts the fields it expects: **is this workspace current?** The reasoning is in
[ADR 6](adr/0006-workspace-versioning-and-migrations.md).

The current version is **5**. A workspace with no `workspace_version` field is version 1 — that
is how a v0.1 workspace is recognised.

Reading an out-of-date workspace works, and warns:

```
warning: workspace needs migration (2 → 5)
```

Writing to one does not. `add`, `link`, `ingest`, `decide`, `promote`, `packs detect`,
`packs apply` and `mode` exit 1 with that message and the hint `run phdude migrate`. The guard is
there because a write mixes shapes: half your claims would carry `provenance` and half would not,
and nothing downstream could tell which half it was looking at.

## Upgrading a workspace

```
phdude migrate --dry-run     # what it would touch, writes nothing
phdude migrate               # do it
git diff                     # read the change before you commit it
```

Look first. `--dry-run` lists, step by step, every file the run would rewrite, and it is a read,
so it works on a dirty tree and on a workspace you have not committed yet.

**git is the undo.** A migration rewrites files in place, so `migrate` exits 3 on a dirty working
tree unless you pass `--force`:

```
working tree has uncommitted changes
  hint: commit or stash first, or pass --force
```

Commit first. Then the migration is one reviewable diff you can revert with `git checkout`.

Running it on a workspace that is already current prints `Workspace is up to date (5)`, records
no event and changes nothing. Running it twice is the same: every step is idempotent, so a run
interrupted halfway is fixed by running it again rather than by hand.

Each applied step appends exactly one `migrate` event to the event log, summarised as
`2 → 3: add the execution policy keys and the dataset, analysis, table and figure directories`,
so the upgrade is part of the project's record like everything else.

`phdude doctor` tells you where you stand without changing anything: it prints the workspace
version and whether it is `(current)`, `(needs migration → 5)` or `(newer than this phdude)`.

## What each step does

| Step | Shipped in | Module | What it adds |
| --- | --- | --- | --- |
| 1 → 2 | 0.2.0 | `migrations/0001-workspace-v2.mjs` | `provenance` on every claim and evidence record, and `contradicts` on every claim. |
| 2 → 3 | 0.5.0 | `migrations/0002-workspace-v3.mjs` | The `execution` and `skills` blocks in the research policy, the dataset and analysis output directories, and the gitignore rules for derived output. |
| 3 → 4 | 0.6.0 | `migrations/0003-workspace-v4.mjs` | The applied-venue list in `phdude.yaml` and an empty `.phdude/templates.yaml`. |
| 4 → 5 | 0.7.0 | `migrations/0004-workspace-v5.mjs` | `reviews/`, the `health.weights` block and the `ready` block in the research policy. |

Detail, because "adds a field" is not the same as "changes your research":

**1 → 2** writes `provenance: { method: imported, derived_from: [] }` onto records that predate
the field, and `contradicts: []` onto claims. `imported` is the honest value: PhDude does not
know who wrote a v0.1 claim or what it came from, and guessing would put a fabricated lineage
into the record. It rewrites no id.

**2 → 3** backfills the execution policy with the shipped defaults — **closed**, `enabled: false`,
and the three runtimes (`node`, `python3`, `Rscript`) named but not enabled — and the skill
permissions with `allow_network: false, allow_execution: false`. An upgrade never opens a
permission. It creates `knowledge/datasets/`, `analysis/out/`, `tables/out/` and `figures/out/`
empty, and appends the rules that keep derived output out of the repository to a `.gitignore`
that already exists. A workspace with no `.gitignore` does not get one: writing it would be
inventing a document rather than backfilling a shape.

**3 → 4** adds the list of venues the project has applied, empty, and an empty template registry,
so `phdude template list` answers the same in a migrated workspace as in a fresh one.

**4 → 5** creates `reviews/` and backfills two policy blocks with the defaults `phdude init`
writes: every health dimension weighted equally, and `ready` requiring `min_health: 70` plus the
seven named requirements. A weight or a threshold you already chose is left exactly as chosen —
each step only ever adds a key that is not there.

## What a migration promises

- **It never renames an id.** A migration that would re-derive ids is not a migration, it is a new
  workspace. One object type has changed its identity in PhDude's history (`RESULT-` in 0.5.0) and
  migration 0002 deliberately does not rewrite those ids; a 0.4.0 result keeps the id it was
  written with. See the breaking-changes section of [CHANGELOG.md](../CHANGELOG.md).
- **It never interprets content.** It backfills what the old shape implies. Anything that needs
  judgement is a research decision and belongs to you, through `phdude decide`.
- **It never opens a permission.** Network and execution stay closed across an upgrade.
- **It never overwrites a value you chose.** Only missing keys are filled in.
- **It is idempotent.** Run it twice, the second run changes nothing.
- **`--dry-run` tells the truth.** Preview and apply compute the same change list, so the dry run
  reports exactly what the real run would touch.
- **Every write is atomic and goes through the store**, so an interrupted run leaves whole files,
  never half-written ones.

## When it goes wrong

**`workspace version 6 is newer than this PhDude (5)`.** Someone on the project is running a
newer PhDude. This is the same problem from the other end and this build cannot fix it: reads
warn, writes exit 1 with the hint `upgrade phdude`. Upgrade, then carry on.

**`no migration from workspace version 3`** or **`malformed migration module …`.** The package's
`migrations/` directory is incomplete or corrupt — an interrupted install, or a partial checkout.
Reinstall PhDude; nothing is wrong with your workspace.

**The diff looks wrong.** You committed first, so `git checkout -- .` puts it back. Then open an
issue with the `phdude migrate --dry-run` output and `phdude doctor`.

**Two people migrated at once.** Whoever pushes second gets a normal git conflict in
`phdude.yaml` and the policy files. Resolve it the way you resolve any conflict, keep
`workspace_version: 5`, then run `phdude migrate` again — it is idempotent and will report
nothing left to do.

## Writing a migration

A change to the *shape* of the workspace is a migration step, not a read-time default. If a
reader has to cope with both shapes forever, the shape never actually changed.

Steps live in the package's `migrations/` directory, one module per step, named
`NNNN-<slug>.mjs`. The runner discovers them by reading the directory, so a step is added by
adding a file, never by editing a registry.

```js
const POLICY_PATH = '.phdude/research-policy.yaml';

// Computed once, so preview and apply cannot disagree about what this step touches.
async function planChanges(store) {
  const changes = [];
  const policy = await store.readYaml(POLICY_PATH);
  if (policy && policy.newKey === undefined) {
    changes.push({ path: POLICY_PATH, policy: { ...policy, newKey: DEFAULT } });
  }
  return changes;
}

export default {
  from: 5,
  to: 6,

  describe() {
    return 'what this step does, in one line, for the CLI and the event log';
  },

  async preview(store) {
    return (await planChanges(store)).map((change) => change.path);
  },

  async apply(store) {
    const changes = await planChanges(store);
    for (const change of changes) await store.writeYamlAtomic(change.path, change.policy);
    return { changed: changes.map((change) => change.path) };
  },
};
```

### The five rules the runtime relies on

1. **Bump `CURRENT_WORKSPACE_VERSION`** in `src/domain/versioning.js` in the same change. The
   runner plans a chain from the workspace's version to that constant; a step nobody chains to
   never runs.
2. **`from` and `to` chain exactly.** `planChain` walks `from` to `from`, so a gap
   (`no migration from workspace version n`) or a step that does not advance the version is a
   hard error, not a skipped step.
3. **`preview` and `apply` agree.** Compute the change list once and use it for both. `--dry-run`
   is the only thing standing between a researcher and an in-place rewrite of their project.
4. **Idempotent.** Guard every write with "is it already there?". The runner's own backstop
   writes `workspace_version` after each step, so a step is free to write it itself or not.
5. **Store only.** A step is handed the `Store` port and nothing else: no `node:fs`, no network,
   no clock. That is what keeps it testable against a temporary directory and unable to reach
   outside the workspace.

### What the store gives you

`readProject` / `writeProject` for `phdude.yaml`, `readYaml` / `writeYamlAtomic` and
`readText` / `writeTextAtomic` for any workspace-relative path, `exists`, `ensureDir`,
`listEntities(type)` / `writeEntity(obj)` / `entityDir(type)` for records, and `appendEvent` —
which you do not call, because the runner appends the one `migrate` event for you.

Report paths with forward slashes. They end up in CLI output, in the event log and in someone's
`git status`, all of which speak posix; `0001-workspace-v2.mjs` shows the `replaceAll('\\', '/')`
that keeps Windows honest.

### Testing it

Cover the step in `tests/unit/application/migrate.test.js`: the change it makes, that a second
run is a no-op, and that `preview` returns what `apply` writes.

If it rewrites entities, add a workspace at the old version under `tests/fixtures/workspaces/`.
Two are there — `v0.1-minimal` and `v0.2-minimal` — and the suite upgrades both to the current
version on every run, which is what stops step 3 from breaking the chain from step 1.

### The paperwork

A shape change is a breaking change. Before you write the migration, read
[docs/versioning.md](versioning.md): a change to a schema's required fields or enums fails
`tests/contracts/schema-stability.test.js` until you bump that schema's `x-phdude.since`, write
this migration, and re-record the snapshot with `UPDATE_SNAPSHOT=1`. Then say what changed in
`CHANGELOG.md`, and add the row to the table above.

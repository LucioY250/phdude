# CLI reference

Every command works the same way: it reads or derives from the workspace on disk, prints a
human-readable report by default and a machine-readable one with `--json`, and exits with a
code that says what kind of thing went wrong.

```
phdude <command> [sub-command] [arguments] [options]
```

## Global options

| Option | Meaning |
|---|---|
| `--json` | Print JSON instead of text. Every command supports it. |
| `--workspace <dir>` | Run against another workspace instead of the current directory. |
| `--actor researcher=<name>,agent=<host>` | Override the recorded actor. Defaults to `git config user.name` (then `$USER`, then `unknown`) and `$PHDUDE_AGENT` (then `cli`). |
| `--version`, `-v` | Print the version and exit. |
| `--help`, `-h` | Print the usage summary and exit. |

`PHDUDE_DEBUG=1` prints a stack trace for unexpected internal errors; without it, users see
the message only.

## Unknown options

Each command declares the options it takes, and anything else exits 1 naming the flag and
listing what that command accepts. A mistyped filter is otherwise indistinguishable from no
filter at all: `knowledge list --stat candidate` would return every object and read as an
answer. The global options above are accepted everywhere.

## Exit codes

| Code | Meaning | Example |
|---|---|---|
| 0 | Success | anything that worked |
| 1 | Usage | unknown command, missing argument, id not found |
| 2 | Validation | an object that fails its JSON Schema, malformed `--json` |
| 3 | Policy | `promote` to canonical without an approved decision |
| 4 | External tool missing | reserved; no v0.1 command requires an external tool |

Errors print the message on stderr, followed by a `Suggested action:` line when the error
carries a hint. With `--json` they print `{"error":{"code","message","hint","details"}}` on
stderr instead. Exit code 4 exists because degradation is the rule in v0.1: a missing
`pdftotext` produces a warning and a partial extraction, not a failed command.

## Commands

### `phdude init [dir]`

Creates a workspace in `dir` (default: the current directory) and is safe to re-run: your
own files are never overwritten, missing ones are added, and the result reports every path
as `created`, `updated` or `skipped`.

```
phdude init --title "Adaptive scheduling in edge clusters" --agents claude-code,codex
```

| Option | Meaning |
|---|---|
| `--title <text>` | Project title. Defaults to the directory name. |
| `--agents <list>` | Comma-separated agent hosts to install. Default `claude-code,codex`. |
| `--no-git` | Skip `git init` even when the directory is not already in a repository. |

`phdude.yaml` and the policy files under `.phdude/` are yours: once they exist, `init` leaves
them alone. An existing `.gitignore` only gains the default lines it is missing.
`AGENTS.md`, `CLAUDE.md` and `.claude/commands/*` are rewritten only while they still carry
the `phdude:managed` marker; delete the marker to take ownership of the file.

**The installed skills are PhDude-managed.** Every file under `.phdude/skills/` is refreshed
on each `init`: one whose content differs from the shipped version is overwritten and reported
under `updated`, so a local edit to a skill does not survive an upgrade. Project-specific
guidance belongs in the policy files under `.phdude/`, or in a workspace pack under
`.phdude/packs/` (see [docs/extending.md](extending.md)).

### `phdude bootstrap`

The command to run on a messy existing project. It ingests `sources/`, scores pack
recommendations, prints `status` and `next`, and finishes with the handoff line that points
the agent at `.phdude/skills/bootstrap/SKILL.md`. It is re-runnable.

### `phdude ingest [paths…]`

Walks the given paths (default `sources/`), hashes every file, detects its kind, extracts
text and tables into `.phdude/cache/ART-<id>/`, links versions, and records one Artifact per
distinct file hash. Unchanged files are skipped unless `--force` is given.

Files that share a hash under different paths collapse into one artifact with several
`paths[]`. Extraction is best effort: a PDF with no `pdftotext` on the machine is still
inventoried and hashed, with `extracted.status` reporting why the text is missing.

Every requested path must resolve inside the workspace. `phdude ingest ../elsewhere` exits 1
rather than recording an external path in a tracked artifact and copying the file's text into
the cache; copy the material into `sources/` first. The check runs twice, lexically and again
on the resolved real path, so a symlink under `sources/` cannot smuggle a directory in from
outside. Symlinks are never followed, for the same reason; each one is reported as
`skipped symlink: <path>` among the warnings rather than ignored in silence.

Ingest reads source material only. `phdude ingest .` walks `sources/`, not the whole
workspace; an explicit path into `knowledge/`, `research/`, `decisions/`, `.phdude/`,
`.claude/`, `authors/`, `manuscript/`, `outputs/`, or at `phdude.yaml`, `AGENTS.md`,
`CLAUDE.md` or `.gitignore` exits 1 with `not a source path: <path>`. Re-importing the
knowledge base as evidence for itself is not a thing anyone wants.

The result carries four keys:

| Key | Contents |
|---|---|
| `artifacts` | Full Artifact objects for what this run created or updated. Empty when nothing changed. |
| `inventory` | Every artifact in the workspace after the run, sorted by id, as `{id, path, kind, role, extracted:{status}}` plus `versions_of` and `latest` when the artifact is one of several versions. |
| `skipped` | Ids of artifacts whose content was unchanged. |
| `warnings` | Per-file extraction warnings; never fatal. |

Read `inventory` rather than `artifacts` when you need the whole picture: re-running ingest
on an unchanged workspace reports zero changed artifacts but the same full inventory. The
text output prints one line per inventory entry, with `+` marking the ones written this run.

### `phdude status`

Project settings, artifact inventory by kind and extraction status, knowledge counts by type
and state, open and resolved fact conflicts, pending decisions, and the last events. Every
number is derived on read; nothing is cached.

### `phdude next`

The highest-impact next action, always with the reasons behind it, the expected impact, and
the exact command to run. Other candidates follow. See PRD §45.

### `phdude knowledge list|show|trace`

```
phdude knowledge list [--type <type>] [--state <state>] [--query <text>]
phdude knowledge show <id>
phdude knowledge trace <id>
```

`list` filters by type (`artifact`, `source`, `claim`, `evidence`, `fact`, `result`,
`question`, `hypothesis`, `method`, `decision`), by state, and by a case-insensitive substring
of the object's primary text. `trace` walks the lineage graph in both directions: `up` is what
the object rests on, `down` is what rests on it.

`trace` prints a `provenance:` line for an object that carries one (claims and evidence):

```
CLAIM-3d035aa05b
  provenance: agent-extraction ← ART-35146e2f6d
```

It reads "extracted by an agent from artifact ART-35146e2f6d". `manual` means a human typed it
at the CLI, `imported` that it predates the field and was filled in by `phdude migrate`.

### `phdude add <type>`

```
phdude add claim --json '{"statement":"…","kind":"empirical","supported_by":["EVID-…"]}'
phdude add fact --file fact.json
```

Types: `claim`, `evidence`, `fact`, `source`, `question`, `hypothesis`, `method`, `result`,
and `artifact-role`. The object comes from `--json '<obj>'` or `--file <path>.json`. Objects
are created in state `candidate`.

Ids are derived from content, so adding the same object twice is a no-op that returns the
existing record and writes no event. What counts as "the same object" is the id material:

| Type | Id material |
|---|---|
| `claim` | `statement` |
| `evidence` | `source`, `locator`, `excerpt` |
| `fact` | `key`, `value`, `from.artifact` |
| `source` | `title`, `year` |
| `method` | `name` |
| `result` | `summary` |
| `question`, `hypothesis` | sequential `RQ-<n>` / `H-<n>`, deduplicated on normalized `text` |

The same excerpt attributed to a different source or page is therefore different evidence,
and the same value reported by two artifacts is deliberately two facts — that pair is the
conflict `status` reports. See [ADR 3](adr/0003-content-derived-ids.md).

`artifact-role` is the exception: it sets `role` on an existing artifact rather than
creating a new object, and takes `{"id":"ART-…","role":"paper"}`.

A method records how the study was done: `{"name":"Cross-sectional survey","design":"…",
"paradigm":"quantitative","sampling":"…","instruments":[…],"analysis":[…],"limitations":[…],
"questions":["RQ-1"]}`. `paradigm` is one of `quantitative`, `qualitative`, `mixed`,
`computational`, `theoretical`, `archival`, `other`; everything but `name` is optional.

Claims and evidence record where they came from. `provenance.method` defaults to `manual` when
the actor's agent is `cli` and to `agent-extraction` otherwise, and `provenance.derived_from`
lists the artifacts behind the object: for evidence, the artifact it cites or its source's
artifacts; for a claim, the union of its evidence's. Pass `provenance` explicitly to override
either, e.g. when importing records whose origin you already know.

`--file` resolves relative to the working directory, not the workspace, so it works when
`--workspace` points somewhere else.

Because `--json` doubles as the payload flag, `phdude add claim --json '{…}'` also prints
JSON. Use `--file` if you want the short text confirmation instead.

References are checked before writing: a claim citing an evidence id that does not exist is
a validation error, not a dangling edge. So is an unrecognised top-level key:
`{"question":["RQ-1"]}` on a claim exits 2 and names the field, because the field is
`questions`. Nothing is silently dropped, which matters because a content-derived id cannot
be corrected afterwards.

### `phdude link <id> --to <id> [<id>…]`

```
phdude link CLAIM-3d035aa05b --to EVID-93cd3745fc RQ-1
phdude link SRC-04b75ed54a --to ART-35146e2f6d
```

Attaches existing objects to an existing object. This is the one edit `add` cannot make:
ids are derived from content, so re-adding a claim with a longer `supported_by` returns the
original record unchanged.

| From | To | Field |
|---|---|---|
| claim | evidence | `supported_by` |
| claim | question | `questions` |
| hypothesis | question | `questions` |
| method | question | `questions` |
| source | artifact | `artifacts` |

`--to` accepts several ids after one flag. Links are additive and idempotent: a target the
object already lists is ignored, and a call that adds nothing writes no file and records no
event. Every target must exist and be of a type the relation accepts, or the command exits 2.

A `canonical` object cannot be linked: it exits 3 and points at `decide propose`, because
canonical knowledge changes only through an approved decision.

### `phdude decide propose|approve|reject|supersede`

```
phdude decide propose --title "Resolve sample_size" --rationale "…" \
  --affects FACT-a FACT-b --change '{"fact_key":"sample_size","canonical_value":142}'
phdude decide approve DEC-… --by "Ada Lovelace"
phdude decide reject  DEC-… --by "Ada Lovelace" --reason "Evidence is too weak"
phdude decide supersede DEC-old --by "Ada Lovelace" --with DEC-new
```

`--affects` accepts several ids after one flag.

A decision's id is derived from `title`, `rationale`, `affects` and `change` together, so
re-proposing under an existing title with a new rationale creates a new proposal instead of
silently returning the old one. Two identical proposals are still one record.

**`--by` is required on `approve`, `reject` and `supersede`.** It records who made the call,
and the runtime deliberately does not fall back to the resolved actor: a decision the
researcher did not make must never end up carrying their name. An agent must never supply a
name of its own, and must ask the researcher rather than guessing.

`supersede` takes the replacing decision in `--with`, not in `--by`: `--by` is the researcher
every time. The v0.1 form that passed a `DEC-` id to `--by` exits 1 with that correction.

### `phdude promote <id> --decision <DEC-id>`

Moves an object to `canonical` (or to another state with `--to`). Promotion to canonical
requires a decision that is `approved` and lists the object in `affects`; anything else
exits 3. This is where human authority over canonical knowledge is enforced.

### `phdude packs list|detect|apply <name>`

`list` shows every discoverable pack and whether it is applied. `detect` scores each pack's
keywords against the cached text and records the recommendation in `phdude.yaml` without
applying anything. `apply` adds the pack to `fields` or `methods` and writes an event; it first
checks each of the pack's skills against the [skill contract](extending.md#skill-contract) and
exits 3 with a `POLICY` error if one requests network access the workspace policy has not
allowed. All three need a workspace: outside one they exit 1 and point at `phdude init`.

### `phdude mode lite|full|ruthless|off`

Sets the review mode in `phdude.yaml`. Setting the mode it already has changes nothing and
records no event.

### `phdude migrate [--dry-run] [--force]`

Upgrades a workspace written by an older PhDude to the current workspace version.
`phdude.yaml` carries `workspace_version`; a workspace without the field is version 1, and the
current version is 2. Migration steps ship with the package, one module per step, and run in
order through the store; each applied step appends one `migrate` event.

Reads keep working on an out-of-date workspace and report `workspace needs migration (1 → 2)`
as a warning. Writes do not: `add`, `link`, `ingest`, `decide`, `promote`, `packs detect`,
`packs apply` and `mode` exit 1 with that message and the hint `run phdude migrate`.

`--dry-run` writes nothing and lists the files each step would rewrite. Because git is the only
undo for an in-place rewrite, `migrate` exits 3 on a dirty git tree unless `--force` is given; a
dry run is a read and stays available either way. Steps are idempotent, so running `migrate` on
an up-to-date workspace prints `Workspace is up to date (2)` and records no event.

### `phdude doctor`

Reports the Node version, whether git and `pdftotext` are available, per-parser
availability, whether the current directory is a workspace, its workspace version and whether
that version needs migrating, the cache entry count, the discoverable packs and the schema
versions, plus warnings for anything missing. It is diagnostic only and never writes.

It also lists every discoverable skill (core, applied packs, and the workspace's own
`.phdude/skills/`) with its source, declared network and workspace permissions, and any loader
warnings — one line each: `<name> (<source>) network=<none|allowed> workspace=<read,...>`. See
[Skill contract](extending.md#skill-contract). `--json` includes the same data as a `skills`
array of `{ name, source, permissions, reads, writes, warnings }`.

### `phdude help`

Prints the usage summary and exits 0. `phdude --help` and `phdude -h` do the same. With
`--json` the summary comes back as `{"usage": "…"}`.

A bare `phdude`, an unknown command and an unparseable argument list are usage errors, not
help requests: they exit 1 and write the error to stderr, following the `--json` error
contract above, with the usage block appended in text mode only.

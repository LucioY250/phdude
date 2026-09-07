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

Creates a workspace in `dir` (default: the current directory) and is safe to re-run:
existing files are never overwritten, missing ones are added and reported.

```
phdude init --title "Adaptive scheduling in edge clusters" --agents claude-code,codex
```

| Option | Meaning |
|---|---|
| `--title <text>` | Project title. Defaults to the directory name. |
| `--agents <list>` | Comma-separated agent hosts to install. Default `claude-code,codex`. |
| `--no-git` | Skip `git init` even when the directory is not already in a repository. |

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
`question`, `hypothesis`, `decision`), by state, and by a case-insensitive substring of the
object's primary text. `trace` walks the lineage graph in both directions: `up` is what the
object rests on, `down` is what rests on it.

### `phdude add <type>`

```
phdude add claim --json '{"statement":"…","kind":"empirical","supported_by":["EVID-…"]}'
phdude add fact --file fact.json
```

Types: `claim`, `evidence`, `fact`, `source`, `question`, `hypothesis`, `result`, and
`artifact-role`. The object comes from `--json '<obj>'` or `--file <path>.json`. Objects are
created in state `candidate`.

Ids are derived from content, so adding the same object twice is a no-op that returns the
existing record and writes no event. What counts as "the same object" is the id material:

| Type | Id material |
|---|---|
| `claim` | `statement` |
| `evidence` | `source`, `locator`, `excerpt` |
| `fact` | `key`, `value`, `from.artifact` |
| `source` | `title`, `year` |
| `result` | `summary` |
| `question`, `hypothesis` | sequential `RQ-<n>` / `H-<n>`, deduplicated on normalized `text` |

The same excerpt attributed to a different source or page is therefore different evidence,
and the same value reported by two artifacts is deliberately two facts — that pair is the
conflict `status` reports. See [ADR 3](adr/0003-content-derived-ids.md).

`artifact-role` is the exception: it sets `role` on an existing artifact rather than
creating a new object, and takes `{"id":"ART-…","role":"paper"}`.

`--file` resolves relative to the working directory, not the workspace, so it works when
`--workspace` points somewhere else.

Because `--json` doubles as the payload flag, `phdude add claim --json '{…}'` also prints
JSON. Use `--file` if you want the short text confirmation instead.

References are checked before writing: a claim citing an evidence id that does not exist is
a validation error, not a dangling edge.

### `phdude decide propose|approve|reject|supersede`

```
phdude decide propose --title "Resolve sample_size" --rationale "…" \
  --affects FACT-a FACT-b --change '{"fact_key":"sample_size","canonical_value":142}'
phdude decide approve DEC-… --by "Ada Lovelace"
phdude decide reject  DEC-… --by "Ada Lovelace" --reason "Evidence is too weak"
phdude decide supersede DEC-old --by DEC-new
```

`--affects` accepts several ids after one flag.

A decision's id is derived from `title`, `rationale`, `affects` and `change` together, so
re-proposing under an existing title with a new rationale creates a new proposal instead of
silently returning the old one. Two identical proposals are still one record.

**`--by` is required on `approve` and `reject`.** It records who made the call, and the
runtime deliberately does not fall back to the resolved actor: a decision the researcher did
not make must never end up carrying their name. An agent must never supply a name of its
own, and must ask the researcher rather than guessing.

### `phdude promote <id> --decision <DEC-id>`

Moves an object to `canonical` (or to another state with `--to`). Promotion to canonical
requires a decision that is `approved` and lists the object in `affects`; anything else
exits 3. This is where human authority over canonical knowledge is enforced.

### `phdude packs list|detect|apply <name>`

`list` shows every discoverable pack and whether it is applied. `detect` scores each pack's
keywords against the cached text and records the recommendation in `phdude.yaml` without
applying anything. `apply` adds the pack to `fields` or `methods` and writes an event.

### `phdude mode lite|full|ruthless|off`

Sets the review mode in `phdude.yaml`. Setting the mode it already has changes nothing and
records no event.

### `phdude doctor`

Reports the Node version, whether git and `pdftotext` are available, per-parser
availability, whether the current directory is a workspace, the cache entry count, the
discoverable packs and the schema versions, plus warnings for anything missing. It is
diagnostic only and never writes.

### `phdude help`

Prints the usage summary and exits 0. `phdude --help` and `phdude -h` do the same. With
`--json` the summary comes back as `{"usage": "…"}`.

A bare `phdude`, an unknown command and an unparseable argument list are usage errors, not
help requests: they exit 1 and write the error to stderr, following the `--json` error
contract above, with the usage block appended in text mode only.

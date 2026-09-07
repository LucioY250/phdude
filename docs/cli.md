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
| 4 | External tool missing, or a script that failed | every search provider failed on a `phdude research` run; a figure generator exited non-zero or timed out |

Errors print the message on stderr, followed by a `Suggested action:` line when the error
carries a hint. With `--json` they print `{"error":{"code","message","hint","details"}}` on
stderr instead. Exit code 4 is rare, because degradation is the rule: a missing `pdftotext`
produces a warning and a partial extraction, and one failed search provider produces a warning
and the other providers' results. Only a `phdude research` run where every provider failed
exits 4.

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

A skill the policy no longer clears for network access is withheld, and one already installed
under an earlier permission is deleted: `removed` in `--json` lists the skill directories that
went, and the text output adds a `removed:` line when there were any.

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
outside.

Symlinks are never followed, and the two ways one turns up are treated differently. A path
named on the command line that resolves outside the workspace exits 1, symlink or not — that is
the containment check above, and it is an error because you asked for exactly that path. Every
other symlink is a warning: one named on the command line that resolves *inside* the workspace,
and every symlink found while walking a directory, is skipped and reported as
`skipped symlink: <path>` rather than ignored in silence. A run that hits only those still
succeeds, with the linked files simply not ingested.

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
and state, a Literature block, open and resolved fact conflicts, disputed claim pairs, pending
decisions, and the last events. Every number is derived on read; nothing is cached.

The **Literature** block counts candidates by state, how many searches are recorded, and how
many research questions have a stale or missing search — the same staleness rule
`phdude freshness` reports in full. Candidates and searches are counted here and nowhere else:
they are not knowledge, so they stay out of the Knowledge block and out of
`phdude knowledge list`.

Disputed claim pairs come from marking claims as contradicting each other (see `phdude link`
below, PRD §3.5): a pair is listed while neither of the two claims has been `rejected`,
whatever states they are in, and drops out once one side is rejected. `--json` reports them as
`disputedPairs: [[a, b], …]`; the text renderer also shows each claim's statement, truncated to
60 characters.

### `phdude next`

The highest-impact next action, always with the reasons behind it, the expected impact, and
the exact command to run. Other candidates follow. See PRD §45.

Two rules read the calendar rather than the knowledge graph. `stale-search` (medium) fires for
every research question with no current literature behind it — never searched, or searched
longer ago than `research.freshness.stale_after_days` — and points at a first
`phdude research` or at `phdude research-fresh`, whichever the first such question needs.
`candidates-pending` (medium) fires at five or more candidates still awaiting a verdict.

### `phdude knowledge list|show|trace`

```
phdude knowledge list [--type <type>] [--state <state>] [--query <text>]
phdude knowledge show <id>
phdude knowledge trace <id>
```

`list` filters by type (`artifact`, `source`, `claim`, `evidence`, `fact`, `result`,
`question`, `hypothesis`, `method`, `decision`), by state, and by a case-insensitive substring
of the object's primary text. A `--type` or `--state` value outside those lists exits 1 naming
the value and listing what is accepted, rather than printing an empty result that reads as "no
such objects". `trace` walks the lineage graph in both directions: `up` is what
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
creating a new object, and takes `{"id":"ART-…","role":"paper"}`. Text mode prints
`Updated <id> role → <role>` when the role changed and `Unchanged <id>` when it was already
that role, which writes nothing and records no event.

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

### `phdude link <CLAIM-a> --contradicts <CLAIM-b>`

```
phdude link CLAIM-3d035aa05b --contradicts CLAIM-8e21a9c440
```

Records that two claims contradict each other (PRD §3.5, §38). `--contradicts` is mutually
exclusive with `--to` and exits 1 if both are given. Both ids must exist and be claims, or the
command exits 2; a claim contradicting itself exits 1.

The relation is symmetric: `contradicts` is written to both claims, deduped and sorted, and
each side moves to `disputed` when its current state allows the transition
(`candidate`/`supported`/`canonical`). A `canonical` claim can be disputed this way with no
decision required - unlike `--to`, the canonical guard does not apply, because surfacing a
contradiction is exactly what PhDude should do proactively (PRD §3.3). A claim already
`disputed` or `rejected` keeps its state. One `link` event is recorded; running the same
`--contradicts` call again writes nothing and records no event.

See [`decisions`](../skills/decisions/SKILL.md) for how a disputed pair gets resolved, and
`phdude status` for where disputed pairs are reported.

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

A claim that contradicts a claim which is not `rejected` has a live contradiction, and the gate
keys on that relation rather than on the state the claim currently sits in: its only moves are
`--to rejected`, or `--to supported`/`--to canonical` with the resolving decision below. Any
other target, `candidate` included, exits 3 with `has unresolved contradiction(s) with …`, so
neither `disputed → candidate → supported` nor rehabilitating a rejected loser can settle a
contradiction without a decision.

Promoting a contradicting claim to `supported` or `canonical` is resolving a contradiction, not
an ordinary promotion, and a single decision must not rehabilitate both sides of a dispute. It
requires an approved decision (see `phdude decide propose` below) whose `change` names, in
`resolves_contradiction`, the claim being promoted and (at least) one of its `contradicts`
partners, and in `survivor` which one of them wins; the promoted claim must be that `survivor`,
must be in the decision's `affects`, and its `resolves_contradiction` must cover every live
contradiction the claim has. Every other claim the decision lists that this claim
still contradicts must already be `rejected` - promote each loser to `rejected` first (no
decision needed for that step, same as any other `disputed → rejected` move), then promote the
survivor. Promoting the losing claim with the same decision exits 3 naming the survivor
instead. Resolving the pair does not touch the loser automatically beyond that manual
rejection, and `contradicts` is kept on the survivor as history of the dispute.

### `phdude cite list|check|export`

```
phdude cite list
phdude cite check
phdude cite export --format bibtex|csl-json
```

The citation registry (PRD §37, spec §3.3): a `bibkey`, deterministically derived unless the
source declares its own, plus BibTeX/CSL-JSON export. **It is derived, never canonical** —
nothing here changes a claim's or evidence item's state, and the citation itself is always the
`SRC-…` id, not the bibkey.

`list` prints every source with its `bibkey`, authors, year, DOI and `cited_by`: the number of
evidence items whose `source` is that SRC id directly. An evidence item that cites an artifact
instead of a formal source does not count — that gap is exactly what `check`'s `uncited-source`
finding reports.

`check` verifies the registry and exits 2 if anything but `uncited-source` is wrong:

| Finding kind | Meaning |
|---|---|
| `uncited-source` | No evidence item cites this source directly. Informational only — it never fails the check by itself. |
| `evidence-missing-source` | An evidence item's `source` id does not exist. |
| `invalid-doi` | A DOI (`identifiers.doi` or the legacy top-level `doi`) does not match `^10\.\d{4,9}/\S+$`. |
| `missing-field` | The source has no `title`, no `authors`, or no `year`. |
| `duplicate-source` | Two sources share the same normalized title and year. |
| `duplicate-bibkey` | Two sources declare the same explicit `bibkey`. |

A source's id is derived from its `title` and `year` (see `phdude add` above), so none of these
fields can be corrected on an existing record in place — fixing one means adding a corrected
source and, once it is not relied on anywhere, removing the mistaken YAML file directly.

`export --format bibtex|csl-json` (default `bibtex`) writes `references.bib` or
`references.json` at the workspace root, covering every source regardless of whether it is
cited. It records no event — a derived artifact, not knowledge — but still refuses on an
out-of-date workspace like any other write (`phdude migrate`).

A source may carry `bibkey` (`^[a-z0-9-]+$`, wins over the derived key), `abstract`, `keywords`
(a string array), and `identifiers: { doi?, isbn?, arxiv?, pmid?, url? }`. The top-level `doi`
and `url` fields from v0.1 still work; `identifiers.doi` takes precedence when both are set.

### `phdude research "<query>" | list | show | accept | dismiss`

```
phdude research "open science practices adoption" --question RQ-1
phdude research "…" --provider openalex,crossref --from 2022 --limit 10 --allow-network
phdude research list --state candidate --question RQ-1
phdude research show CAND-…
phdude research accept CAND-… --type article
phdude research dismiss CAND-… --reason "measures a different construct"
```

Fresh literature search (PRD §22, §71–§77, spec §3.3–§3.4). **This and `research-fresh` are the
only commands that touch the network**, and it refuses unless `.phdude/research-policy.yaml`
sets `network.enabled: true` or the call carries `--allow-network`:

```
network access is disabled
Suggested action: set network.enabled: true in .phdude/research-policy.yaml or pass --allow-network
```

A call carries the query string, the result limit and `from` year as that provider's own filter
parameters, a `phdude/<version>` User-Agent, and — where they apply — the polite `mailto` and
the provider's API key (see below). Nothing from the workspace's documents goes with it: no
file, no excerpt, no filename. Every provider call appends one `search` event carrying the
provider, the query and a result count — never a result payload, and never a key.

The five providers are `openalex`, `crossref`, `arxiv`, `semantic-scholar` and `pubmed`;
`providers:` in the policy names which of them this workspace uses, and in what order.

Two of them take an API key, and both are read from the environment only — no key is ever read
from the workspace, and both providers answer at the anonymous rate limit without one. Semantic
Scholar takes `PHDUDE_S2_API_KEY`, sent as an `x-api-key` header. PubMed takes
`PHDUDE_NCBI_API_KEY`, sent as the `api_key` query parameter NCBI documents — a key in a query
string is logged by proxies in a way a header is not, which is worth knowing before you set it.
Neither key ever reaches an error message or the event log.

OpenAlex and Crossref ask for a polite contact address: PhDude sends the `email` from
`.phdude/author-profile.yaml` as `mailto` when the profile has one, and nothing when it does
not.

| Option | Meaning |
|---|---|
| `--question RQ-n` | Tie the search and its candidates to a research question. The id must exist, or the command exits 2. Without it the search is still recorded, with `question: null`. |
| `--provider a,b` | Narrow to a subset of the configured providers, in that order. It can only narrow: a provider the policy does not list is a usage error. |
| `--from YYYY` | Override `research.year_range.from` for this run, server-side and client-side. |
| `--limit N` | Override `research.limit` for this run. It is per provider, not a total. |
| `--allow-network` | Allow this one run through a closed `network.enabled`. |
| `--state`, `--question` | Filters for `research list`. |
| `--type <t>` | The source type `research accept` records. Defaults to the candidate's own type. One of `article`, `book`, `chapter`, `thesis`, `report`, `preprint`, `web`, `dataset`, `other`. |
| `--approve-preprint` | Required by `research accept` for a candidate flagged `needs_approval`. |
| `--reason "…"` | Required by `research dismiss`. |

What a run does, in order: check the policy, check the question, call each configured provider
in turn, deduplicate across providers, apply the policy filters, score, then write. A provider
that fails is reported as a warning and the run continues on what the others returned; only a
run where **every** provider failed exits 4 (`all providers failed`).

Two providers returning the same work produce **one** candidate: works match on their DOI
(case-insensitive) or on their normalized title and year. The first provider to return it owns
the record — its `provider` and `external_id` are kept — and the others are listed in
`providers[]` with their own ids under `ext.ids`. A field the owner left empty (`doi`, `url`,
`venue`, `abstract`, `year`, `cited_by`, `open_access`) is filled from a provider that did
report it; a field it reported is never overwritten.

A candidate's `CAND-` id is derived from the **work** — its DOI, or its normalized title and
year — not from the provider that returned it. Re-running a query with a different `--provider`
order, or with only one of them, therefore finds the same candidates rather than creating a
second copy of each.

Ranking is deterministic and explained in `--json` under `score_parts`: `rank` is
`1/(1+position)` after deduplication, `citations` is `log10(1+cited_by)/4` (0 when the provider
reports none), and `recency` decays linearly over ten years from the current year (0 when the
year is unknown). Each part is rounded to three decimals and `score` is their sum. It is a
sorting aid, not a verdict.

A candidate whose `type` is `preprint` is flagged `needs_approval: true` under
`research.preprints.require_approval` — listed, never hidden, and never accepted on its own.

`research list` prints recorded candidates highest score first, filtered by `--state`
(`candidate`, `accepted`, `dismissed`) and `--question`. `research show <id>` prints one
candidate, or the search record behind it, as YAML.

Re-running the same query for the same question appends a run to the same `SEARCH-…` record
instead of creating a second one, and a candidate already on disk is reported under
`existing` rather than rewritten — the state and reason a researcher gave it are never reset by
a re-run. Nothing a later run learned is merged into a stored candidate either, with one
exception: a work an earlier run recorded with no DOI, because the provider that returned it
did not report one, takes the DOI a later run learns. Its identity moves from the title key to
the DOI key, so it is filled in and keeps the id it already has (`doi`, `url`, `ext.ids` and
`providers`) instead of the same paper being filed twice. It still counts as `existing`.

#### Accepting and dismissing

`research accept <CAND-id>` is the only path from a search result into the citation registry.
It creates a `SRC-…` with the candidate's `title`, `authors`, `year`, `venue`, `abstract` and
`type` (or `--type`), its identifiers under `identifiers` (`doi`, `url`, `arxiv`, `pmid` — only
the ones a provider actually reported), `provenance: { method: imported, derived_from: [] }`,
and `ext.research` recording which candidate, provider and external id it came from and who
accepted it. Nothing is invented: a field no provider returned stays empty, and `cite check`
reports it afterwards. The candidate moves to `accepted` and records `accepted_as`.

If the workspace already records that source — the same normalized title and year — the
candidate is linked to it and the existing record is left exactly as it is.

A candidate flagged `needs_approval` (a preprint, under `research.preprints.require_approval`)
exits 1 unless the call carries `--approve-preprint`. That flag is the researcher's answer to
that particular preprint, not a default.

`research dismiss <CAND-id> --reason "…"` records that the candidate is not going in, and why.
The reason is required: a dismissed candidate keeps coming back in every future search, and the
next reader needs to know it was read rather than missed.

Both refuse a candidate that is not still in state `candidate` (exit 3) — re-deciding an
accepted one would orphan the source it created. Each writes exactly one `research` event:
`accepted CAND-… as SRC-…`, or `dismissed CAND-…: <reason>`.

### `phdude research-fresh [--question RQ-n] [--all] [--allow-network]`

```
phdude research-fresh
phdude research-fresh --question RQ-1
phdude research-fresh --all --allow-network
```

Re-runs recorded searches that have gone stale — `last_run` at least
`research.freshness.stale_after_days` days ago — exactly as they ran the first time: the same
query, question, providers and filters, read back off the `SEARCH-…` record. `--question RQ-n`
narrows it to one question's searches; `--all` re-runs every recorded search regardless of age.

It reaches the network on the same terms as `research`, and refuses the same way when the
policy is closed. Each re-run appends its runs to the search it came from and its own `search`
events, so the audit trail is identical to running the query by hand.

It reports **only new candidates**: `{ reran, newCandidates, warnings }`. A re-run that finds
the same literature again is the answer "nothing has changed", and listing the same twenty
papers a second time would bury it.

A stored search can outlive what it points at — a question deleted by hand, say. That one record
is reported as a warning (`skipped SEARCH-…: unknown question RQ-n`) and the rest of the due
searches still run; one unrunnable record does not discard the re-runs already done.

Removing a provider from `providers:` is the other way a stored search outlives its workspace,
and it is an ordinary config edit. A search is re-run against whatever providers it recorded
that the policy still lists, with the rest reported as
`SEARCH-…: provider(s) crossref no longer configured`; a search with no provider left in common
is skipped the same way (`skipped SEARCH-…: provider(s) … no longer configured`). Neither ends
the run.

### `phdude freshness [--json]`

```
phdude freshness
phdude freshness --json
```

How current the workspace's literature is (spec §3.4). Per research question: the last search,
how many days ago that was, whether the policy calls that stale, and how many searches it has.
Per source: its year and age in years, or that no year was recorded. Then a summary — how many
questions are stale, how many were never searched, how many searches and sources exist, and the
median and oldest source age.

A question nobody has ever searched is stale by definition: there is no literature behind it at
all, which is the more urgent case, not the exempt one. A search whose `last_run` cannot be
read does not count as a search — an unusable timestamp must not be able to present a question
as freshly searched.

Read-only: no network, no event, nothing written.

### `phdude edit <id> --json '<fields>'`

```
phdude edit CLAIM-… --json '{"tags":["method"],"sections":["methods"]}'
phdude edit SRC-… --json '{"venue":"Journal of Reproducibility"}'
phdude edit ART-… --file role.json
```

Corrects the non-identity fields of a recorded object in place, and writes one `edit` event
naming the fields that changed. Fields come from `--json '<object>'` or `--file <path>.json`,
the same two carriers `phdude add` takes.

Three refusals, and they are the point of the command:

| Refusal | Exit | Why |
|---|---|---|
| The object is `canonical` | 3 | Canonical knowledge belongs to the researcher. Propose a Decision instead. |
| The field is an identity field | 2 | Most ids are derived from these (ADR 0003), so changing one would mean a different object wearing the old object's id. Record the correction with `phdude add`; the original stays as the history of what was believed. |
| The field is not editable | 2 | A field the schema does not know is a typo, and the fields other commands own are left to them. |

| Type | Identity fields (never editable) | Editable |
|---|---|---|
| `claim` | `statement` | `kind`, `supported_by`, `questions`, `sections`, `provenance`, `tags` |
| `evidence` | `source`, `locator`, `excerpt` | `strength`, `provenance`, `tags` |
| `fact` | `key`, `value`, `from` | `unit`, `tags` |
| `source` | `title`, `year` | `authors`, `venue`, `doi`, `url`, `type`, `artifacts`, `bibkey`, `abstract`, `keywords`, `identifiers`, `provenance`, `tags` |
| `result` | `summary` | `from`, `values`, `tags` |
| `decision` | `title`, `rationale`, `affects`, `change` | `tags` |
| `method` | `name` | `design`, `paradigm`, `sampling`, `instruments`, `analysis`, `limitations`, `questions`, `tags` |
| `question` | `text` | `objectives`, `tags` |
| `hypothesis` | `text` | `questions`, `tags` |
| `artifact` | (none) | `role`, `tags` |

`state` is deliberately absent from every "editable" column: moving an object between states is
`phdude promote`, which is where the state machine and the approved-Decision requirement live.
So are the fields other commands own — a claim's `contradicts` (recorded by `phdude link`), a
decision's `status` and `approved_by` (`phdude decide`), and an artifact's inventory fields
(`phdude ingest`). A candidate is not editable at all: it is reviewed with
`phdude research accept|dismiss`.

The result is validated against the object's schema before anything is written, so a value of
the wrong shape exits 2 naming the field rather than leaving a broken file on disk.

### `phdude matrix [--format md|csv] [--question RQ-n]`

```
phdude matrix
phdude matrix --format csv
phdude matrix --question RQ-1
```

The literature matrix (PRD §112, spec §3.4): one row per source. Deterministic order — year
descending, sources without a year last, then bibkey. `--format` (default `md`) chooses a
GitHub-flavored Markdown table or CSV; `--json` returns the full row objects regardless of
`--format`.

| Column | Meaning |
|---|---|
| Bibkey | The source's derived or explicit bibkey (see `cite` above). |
| Year | `-` when the source has no year. |
| Type | The source's `type` (`article`, `book`, …). |
| Questions | Research question ids reached via evidence → claim → question — only evidence whose `source` is this SRC id directly. `-` if none. |
| Claims | Ids of the claims that reach the source that way. `-` if none. |
| Strongest evidence | The strongest `strength` among evidence citing the source directly (`strong` > `moderate` > `weak` > `unknown`), or `-` if nothing cites it. |
| Facts | Ids of facts extracted `from.artifact` any artifact in the source's own `artifacts` list. `-` if none. |
| Methods | Pack-declared method tags from `ext.<pack>.methods`, if a pack has recorded any. `-` if none. |

A row with an empty Questions column means the source is recorded, and may even be cited by
evidence, but that evidence is not yet attached to any claim — it has not been used to support
an argument yet. `--question RQ-n` filters to rows whose Questions column includes that id; an
id no research question carries exits 1 with `not found: RQ-n`, since an empty table would
otherwise read as "no source addresses this question".

### `phdude gaps`

```
phdude gaps
phdude gaps --json
```

An explainable gap report (PRD §112, spec §3.4), grouped by severity (`high`, `medium`, `low`)
and sorted by severity, then kind, then id. Text mode prints each gap's kind and id with a
concrete `Why:` line and a runnable `Command:` line; `--json` returns `{ gaps, counts }`.

| Kind | Severity | Meaning |
|---|---|---|
| `question-without-claims` | high | No claim addresses this research question. |
| `question-only-candidates` | medium | Every claim addressing this question is still `candidate`. |
| `question-without-method` | medium | No method's `questions` includes this research question. |
| `question-never-searched` | medium, or low with the network closed | No recorded search is tied to this research question. |
| `stale-search` | low | The question's newest search ran at least `research.freshness.stale_after_days` days ago. |
| `claim-without-evidence` | high | A non-`rejected` claim's `supported_by` is empty. |
| `claim-weak-evidence` | medium | Every evidence item supporting the claim has `strength: weak`. |
| `hypothesis-untested` | medium | No claim addresses any of the hypothesis's questions. |
| `uncited-source` | low | No evidence item's `source` is this SRC id directly - the same rule, and the same name, as `cite check`'s `uncited-source` finding. |
| `artifact-unmined` | low | The artifact's role is classified (not `unknown`), but no source, fact, or evidence references it. |
| `open-conflict` | high | An unresolved fact conflict (see `status` above), one gap per conflict key. |
| `disputed-pair` | high | A pair of claims that contradict each other with neither side `rejected` (same rule as `status`'s disputed pairs). |

`question-never-searched` and `stale-search` are the gap report's view of the same staleness
`phdude freshness` reports in full and `next` raises as its `stale-search` rule. The
never-searched case outranks the aged one: a question with an old search at least has
literature behind it.

Both read the network policy. With `network.enabled: false` the command a gap prints becomes
`set network.enabled: true in .phdude/research-policy.yaml, then phdude research …`, because the
search on its own would refuse; `question-never-searched` also drops to `low`, since a workspace
that closed the network has decided where its literature comes from rather than overlooked it.
`next`'s `stale-search` rule carries the same prefix on the same condition.

`gaps` is read-only; it writes no event. `next` recommends running it (rule `gaps`, medium)
once one high-severity gap or 3 gaps of any severity exist; the ranking decides where that lands
among the higher-impact rules. `next`'s closing `consistent` line reads
`N open gap(s); run phdude gaps` whenever the report is not empty, and claims the workspace is
consistent only when it is.

### `phdude data add <path> | list | show <id> | profile <id>`

```
phdude data add data/survey.csv
phdude data add data/interviews.csv --json '{"description":"Round 1","license":"CC-BY-4.0","sensitive":true}'
phdude data list
phdude data show DATASET-…
phdude data profile DATASET-…
```

Registers a file under `data/` as a research object (spec §3.2) and profiles it, so an analysis
can say which data it ran on and `repro` can say when that data changed.

The file's bytes are the identity: the id is `DATASET-<first 10 of the sha256 of the bytes>`.
Adding the same file again is a no-op — no event, no second record, and the reply says
`Unchanged`. Editing the file and adding it again records a *new* dataset, whose `versions_of`
points at the first one at that path and whose `latest` is `true`; every earlier version has
`latest: false`. That is the same shape `phdude ingest` uses for artifact versions, and it is
why an analysis that ran on the old bytes still names the dataset it actually read.

| Field | Where it comes from |
|---|---|
| `path` | The argument, workspace-relative. It must resolve inside `data/`, or the command exits 2. |
| `hash`, `bytes` | The file itself. |
| `format` | The extension: `csv`, `tsv`, `json`, `xlsx`, anything else `other`. |
| `profile` | The parsed table (see below). |
| `description`, `license`, `sensitive` | `--json '<object>'` or `--file <path>.json`. Nothing else is accepted. |
| `state` | Always `candidate` on registration, like every other new object. |

The profile is a count of what is in the file, never a finding about it. `csv` and `tsv` are
read as delimited text, `xlsx` through the OOXML parser (first sheet), and `json` only when it
is an array of objects, whose keys become the columns. Any other shape — `other`, a bare JSON
object, an array of numbers — is registered and hashed with an empty profile, because PhDude
will not guess at a table that is not there.

Per column, over the non-empty cells: `inferred_type` is `number` when every cell is numeric,
then `boolean` (`true`/`false`/`yes`/`no`), then `date` (`YYYY-MM-DD` or a full ISO timestamp),
`empty` when the column has no values at all, and `string` otherwise. A column of `0`s and `1`s
is a `number`: the report says what the cells hold, not what they might have meant. `missing`
counts the blank cells, including the ones a short row never had. `distinct` is capped at 50,
and `distinct_truncated: true` says the real count is higher. `samples` carries up to five
distinct values.

With `sensitive: true` the `samples` are omitted entirely, everywhere. The profile is committed
to the repository, and five values are enough to expose the column they came from; the types,
the missing counts and the distinct counts stay.

`data list` prints one line per dataset with its path, format and shape, marking superseded
versions. `data show` prints the whole record as YAML. `data profile` prints the column table.
Only `data add` writes: one `data` event per registration, naming the new dataset and every
version it superseded. The three readers write nothing.

### `phdude table add --json '<declaration>' | list | show <id> | build <id>`

```
phdude table add --json '{"name":"mean-weight","caption":"Mean weight by group.","source":{"result":"RESULT-…"}}'
phdude table add --file table.json
phdude table list
phdude table show TABLE-…
phdude table build TABLE-… --format csv
phdude table build TABLE-… --force
```

A table is a declaration, not a file: which source it renders, which columns, in which formats.
`build` turns it into files under `tables/out/` and records what it read and what it wrote, so a
reader months later can tell which numbers a table in the manuscript came from.

| Field | Meaning |
|---|---|
| `name` | Lowercase words joined by `-`. It is the identity, and it is the filename under `tables/out/`. |
| `caption` | The sentence under the table. Required. |
| `source` | Exactly one of `{"result":"RESULT-…"}` or `{"dataset":"DATASET-…","columns":["…"],"limit":n}`. |
| `columns` | `[{"key":…,"label":…,"format":…}]`. Omit it and every key the source has becomes a column. |
| `formats` | Any of `md`, `latex`, `csv`. All three when omitted. |

`format` is `text`, `number:<0-9>` or `percent:<0-9>`. `number:2` prints `71.40`; `percent:1`
reads the value as a fraction and prints `42.4%`. A cell the format cannot read as a number is
printed as it was written — the renderer reports the analysis, it does not correct it.

A **result** source renders one row per key of its `values` (columns `key` and `value`), in the
order the analysis wrote them; a result whose `values` is a list of row objects renders those
rows. A **dataset** source renders the parsed file, header first, narrowed by `columns` and
`limit`. A dataset PhDude cannot parse into a table is a validation error rather than an empty
table.

The Markdown form is a pipe table with a `Table:` caption line and numeric columns right-aligned.
The LaTeX form is a `booktabs` `table` with a `\caption`, a `\label{tab:<name>}` and `& % $ # _
{ } ~ ^ \` escaped. The CSV form is the header and the rows, quoted per RFC 4180, with no caption.

Declaring the same name again corrects the declaration in place — same id, same build history —
and a declaration identical to the recorded one writes nothing and records no event.

`build` is up to date, and writes nothing, when the source hashes to what the last run recorded
*and* every output file already holds exactly the bytes this build would write. `--force` builds
anyway. `--format` narrows the build to some of the formats the table declares; a format it does
not declare exits 2. One `table` event per declaration and per build; `list` and `show` write
nothing.

The recorded `source_hash` is the source as it is now: a dataset hashes to the bytes on disk, not
to the bytes registered with `phdude data add`. Editing the file is what has to make everything
built from it stale, and nothing watches the file for that to happen.

### `phdude figure add --json '<declaration>' | list | show <id> | build <id> | check`

```
phdude figure add --file figure.json
phdude figure list
phdude figure show FIG-…
phdude figure build FIG-… --allow-exec
phdude figure check
```

A figure is a declaration too: its alt text, the generator that draws it, what it is drawn from,
and the files it writes.

| Field | Meaning |
|---|---|
| `name` | Lowercase words joined by `-`; the identity. |
| `caption` | The sentence under the figure. Required. |
| `alt` | What the figure **shows**, in one sentence (PRD §100). Required and non-empty; a figure without it never becomes a record. |
| `generator` | `{"runtime":…,"script":…,"args":[…]}`. |
| `inputs` | `RESULT` and `DATASET` ids. What the run hashes, and what makes the figure stale. |
| `outputs` | `[{"path":"figures/out/….svg","format":"svg\|png\|pdf"}]`, at least one, all under `figures/`. |

`script` is either `phdude:bar-chart` — the accessible SVG generator the package ships — or a
script the workspace holds under `figures/`. Nothing else runs. `runtime` is resolved through
`execution.runtimes` in `.phdude/research-policy.yaml`; a runtime the workspace never named exits
2. The generator is run with `execFile` and an argument array, never a shell, with the workspace
as its working directory and an environment holding `PATH`, `HOME`, `LANG`, `PHDUDE_WORKSPACE`
and `PHDUDE_FIGURE` — nothing else of yours reaches it.

`build` refuses with exit 3 unless `execution.enabled: true` or `--allow-exec`. After the
generator exits it verifies that every declared output is on disk, hashes each one, and appends a
run `{at, exit, duration_ms, input_hashes, output_hashes}`. Every build is recorded and every
build is one `figure` event, including the ones that failed:

- A non-zero exit records the run with its exit code, hashes nothing, prints the generator's last
  lines of output, and exits 4.
- A generator that exits 0 without writing what it declared is treated the same way: the run is
  recorded, nothing is hashed, and the missing paths are named. Exit 4.
- A generator that outruns `execution.timeout_seconds` records the run with `exit: null` and
  exits 4 pointing at the policy key.

`check` reports, for every figure: `up-to-date`, `stale` (an input hashes differently from the
last successful run, or is gone), `missing-output` (a declared file is not on disk) or
`never-run`, plus `missing-alt` for a figure whose alt text was edited away. It runs nothing,
writes nothing and always exits 0 — a stale figure is a state to fix, not a failure.

### `phdude prose <section> | --file <path>`

```
phdude prose introduction
phdude prose introduction --json
phdude prose --file draft.md
phdude prose --file borrador.md --lang es
```

The Academic Prose Quality report of PRD §39.1: six sub-scores, each derived from located
observations a researcher can open and dispute, followed by every observation with its line, the
sentence it names, what is wrong and what to do about it. It reports; it never blocks, and it
always exits 0.

With a section id it reports on that manuscript section with the evidence graph behind it, so
Evidence Alignment and Epistemic Precision are real numbers, and it rewrites
`manuscript/reports/<section>.yaml`. The whole record is recomputed together — the hash of the
body it measured, the timestamp, one row per gate from a run of all six, the scores and the
warning and block counts — so no number is ever stamped with a hash that does not describe it.
That report is a derived file, like `references.bib`: it records no event, and neither the prose
nor `manuscript.yaml` is touched. A section written under a voice profile also lists, under
`Voice`, the `gate-voice` comparisons its Author Voice score came from, so the screen shows the
same findings the stored report counted. A section whose file no longer hashes to the record in
`manuscript.yaml` is reported as drifted, on the line under the heading and as `drift` under
`--json`.

With `--file` it reports on any text file and needs no workspace at all. `--lang` picks the
language resources (`en` and `es` ship). A language with no resources runs only the structural
rules and says so as an `info` observation.

| Sub-score | Built from |
|---|---|
| Specificity | vague-literature, banned-phrase and empty-phrase findings per 100 words |
| Evidence Alignment | markers that resolve to nothing, claims with missing or weak-only evidence, unmarked numerals — `n/a (needs manuscript context)` for a bare file |
| Epistemic Precision | asserted rejected claims, verbs stronger than the claim state allows, stacked hedges — `n/a` for a bare file |
| Structural Variation | sentence-length SD, opening diversity, transition rate |
| Author Voice | the active voice profile — `n/a` for a bare file |
| Conciseness | empty-phrase and intensifier density, plus mean sentence length above 30 words |

The exact formula behind every sub-score is in the report's `formulas` object under `--json`,
and the aggregate is their weighted mean over the sub-scores that could be computed.

| Rule | Fires when |
|---|---|
| `transition-density` | Over 40% of a paragraph's sentences open with a connective (paragraphs of 3+ sentences). |
| `sentence-monotony` | 5+ sentences in a paragraph whose lengths vary by under 3 words. |
| `repeated-openings` | 3+ sentences in a paragraph open with the same two words. |
| `banned-phrase` | A phrase from the language's generic-register list. |
| `empty-phrase` | Filler that can be deleted without losing meaning. |
| `unsupported-intensifier` | An intensifier in a sentence with no citation and no `fact:`/`result:` marker. |
| `vague-literature` | A claim about a body of work with no citation in the sentence. |
| `symmetrical-lists` | 3+ consecutive list items open with the same word. |
| `excessive-hedging` | 3+ hedges in one sentence. |

Every rule is a `warn`, except the empty phrases a careful academic writer does use (`in order
to`, `in terms of`, and their Spanish equivalents), which are `info` and never score against the
text. The `ruthless` review mode turns every warning into a block inside the writing pipeline and
leaves `info` alone; `lite` reports the prose gate's findings as `info`; `off` runs the rules for
the scores and reports none of them (PRD §40). The same rules run as the writing pipeline's prose gate, and the
`academic-prose` skill's `scripts/prose-lint.mjs` reaches them through this command, so there is
one implementation of every rule.

**No detector scores, ever.** PhDude does not compute, accept or target an AI-detection score
(PRD §30c). Any option whose name contains "detect" or "humaniz" — on this or any other command —
is refused with a policy error and exit 3.

### `phdude write <section>`

```
phdude write introduction
phdude write introduction --voice a-researcher --budget 6000
phdude write introduction --json
```

Assembles the writing context of PRD §70 for one section and prints the draft contract. It
writes `.phdude/cache/writing/<section>/context.md` and nothing else: no section file, no
manuscript entry, no event. The prose is the agent's; the record is `manuscript submit`'s.

The context is built in this priority order, and the budget is spent in it:

| # | Item | What it carries |
|---|---|---|
| 1 | Task instruction | The section's purpose, the manuscript title and language. Always included. |
| 2 | Canonical facts | The project title, the research questions, the methods, the established values. |
| 3 | The section's claims | One item per claim: its state, the marker to assert it with, and its strongest evidence (excerpt, locator, citation key). |
| 4 | Citation keys | Every source with the key to cite it by. |
| 5 | Writing policy | `.phdude/writing-policy.yaml`. |
| 6 | Voice profile | The learned fields and the preserve/avoid lists, or a line saying no profile is recorded. |
| 7 | Verb table | The epistemic verbs, filtered to the states the section's claims are in. |

`--budget` is a character count (12000 by default). Items are taken in priority order while they
fit; the first one that does not fit, and everything after it, is reported under `truncated`
rather than shortened — half an excerpt is worse than no excerpt.

The section's claims are the ones the plan lists in `manuscript.yaml`. When the plan lists none,
the context falls back to every supported or canonical claim addressing one of the section's
questions.

`--voice` names an author profile, read from `authors/<id>.yaml`; without it the manuscript's own
voice is used. A workspace with no profile recorded is not an error: the context says so, and the
agent writes plainly rather than in an invented voice.

### `phdude deslop <section>`

```
phdude deslop introduction
phdude deslop introduction --file revised.md
phdude deslop introduction --file revised.md --allow-additions
```

The revision half of the writing pipeline (spec §3.5). Without `--file` it prints the section's
current prose report and the revision contract: what to change, and what must be preserved
exactly — every claim marker, every citation, every number, every negation.

With `--file` it runs every gate over the revision, `gate-meaning` included, comparing it against
the section as it stands. A revision that drops a claim marker, a citation, a number or a
negation is blocked and nothing is written. A revision that adds a claim or a citation is blocked
too, unless `--allow-additions` says the researcher meant it: new assertions belong to a draft,
not to a cleanup pass. A clean revision is recorded as `revised`, with its report and exactly one
event, `deslop <section> (revised)`.

An approved section is refused: reopen it first.

**No detector scores, ever.** "Deslop" means clearer, more specific, better-evidenced prose. It
does not mean evading a classifier, and PhDude has no number for that (PRD §30c).

### `phdude manuscript init|list|show <s>|status|submit <s>|approve <s>|reopen <s>`

```
phdude manuscript init [--title "…"] [--language en] [--voice <author-id>|consensus]
phdude manuscript list
phdude manuscript show <section>
phdude manuscript status
phdude manuscript submit <section> --file <draft.md> [--revision] [--allow-additions]
phdude manuscript approve <section> --decision <DEC-id>
phdude manuscript reopen <section>
```

The manuscript model of PRD §33 and spec §3.1: `manuscript/manuscript.yaml` holds the title,
the language, the voice and one entry per section; the prose lives in `manuscript/<section>.md`
next to it. See [the workspace guide](workspace.md#the-manuscript) for the file layout.

`init` writes `manuscript.yaml` with the six standard sections — abstract, introduction,
methods, results, discussion, conclusions — all `planned`, and writes no section file: a section
file appears the first time a draft passes `submit`. `--title` defaults to the project title and
`--language` to the project language. `--voice` takes an author profile id or `consensus` (the
default), which is the project voice of PRD §30.2. A workspace holds one manuscript: `init`
exits 3 rather than overwriting an existing one.

`list` prints the sections in order; `status` adds the counts by status; `show <section>` prints
the entry and the body of the section file. When the body on disk no longer hashes to the
`hash` in `manuscript.yaml`, `show` adds a `drift:` line saying the section was edited outside
PhDude since its last submit; `--json` carries the same as `drift: { recorded, actual,
drifted }`. Only a submit moves the recorded hash, so the notice stays until the text goes back
through the gates.

`submit` is the only way prose enters `manuscript/`. It reads the draft at `--file` (a path
relative to your shell, not to the workspace), strips any front matter it carries, and runs the
deterministic writing gates over the body. A gate finding of severity `block` means **nothing is
written**: the command prints each finding as `<gate>:<line> <message>` and exits 2. When the
draft is clean, `submit` writes the section file with its front matter, updates the section's
status and hash in `manuscript.yaml`, stores the gate report at
`manuscript/reports/<section>.yaml`, and appends one `manuscript` event.

The gates, in the order they report:

| Gate | Blocks on | Warns on |
|---|---|---|
| `gate-citations` | a `[@key]` that resolves to no recorded source, or one whose accepting candidate was dismissed | — |
| `gate-evidence` | a `<!-- claim:/fact:/result: -->` marker naming nothing, a paragraph asserting a `rejected` claim, a verb stronger than the claim's state or its evidence allows | a numeral of two digits or more with neither a marker nor a citation in its sentence |
| `gate-prose` | every prose rule, in `ruthless` mode | every prose rule, in `full` mode |
| `gate-voice` | — (voice never blocks, `ruthless` mode included: a learned baseline describes a habit, not a defect) | with an author profile that has run `learn`: any of mean sentence length, its spread, opening diversity, transition rate and first-person rate outside its tolerance, named with the observed value, the learned value and the band (`mean sentence length 31.2 vs learned 18.4 ± 4.6`); a word the profile's `terminology.avoid` lists. A term the section's claims use and the profile preserves, missing from the draft, is `info`. Author Voice scores 100 − 25 × the mean deviation across those five metrics, each in multiples of its own tolerance |
| `gate-meaning` | on `--revision` only: a claim, citation, number or negation the revision dropped, or a claim or citation it added without `--allow-additions`; a bare single digit ("3 waves" → "three waves") is not a number for this purpose | — |
| `gate-profile` | with `target_profile` set: a section over the venue's word limit | a section the venue does not list, or one out of the venue's order |

Citations follow Pandoc: `[@key]`, `[@a; @b]`, `[@a, p. 3]` and `[see @a]` all cite, and every
`@key` inside the brackets is audited.

When the draft is accepted, the full report — findings included — is written to
`.phdude/cache/writing/<section>/report.json`, and `manuscript/reports/<section>.yaml` records
the canonical summary: the gates, the six scores and the counts, never prose. A blocked submit
writes neither, and nothing else either: the workspace is left exactly as it was and the
findings reach you through the error.

The section's status becomes `draft`, or `revised` with `--revision`. The transitions are
`planned → draft`, `draft → revised|approved` and `revised → revised|approved`; `--revision` on a
`planned` section is a policy error, because there is no draft to revise.

`approve` records the researcher's approval of a section. It requires an **approved** Decision
whose `affects` lists `manuscript:<section>` — the one place the decision schema accepts a
string that is not an object id. Propose that decision and let the researcher approve it (see
[`phdude decide`](#phdude-decide-proposeapproverejectsupersede)), then run
`phdude manuscript approve introduction --decision DEC-…`.

Anything less exits 3: no decision, a decision that is still proposed, or one that affects a
different section. The section's hash is frozen at that point.

`reopen` takes an approved section back to `revised` and drops its `approved_by`, which is the
only way out of `approved`: a `submit` over an approved section exits 3 instead of overwriting
it (PRD §3.4 — approved manuscript text is the researcher's).

Every mutation records exactly one event: `manuscript initialized (N sections)`,
`submitted <section> (<status>)`, `approved <section> (<DEC-id>)`, `reopened <section> (revised)`.

### `phdude authors list|show <id>|add --json|learn <id> --from <path…>|consensus`

```
phdude authors list
phdude authors show researcher-a
phdude authors add --json '{
  "id": "researcher-a",
  "language": "en",
  "tone": { "academic": true, "assertiveness": "moderate", "first_person": "sparing" },
  "sentences": { "length": "varied", "openings": "varied" },
  "paragraphs": { "density": "medium" },
  "transitions": "minimal",
  "terminology": { "preserve": ["decision process"], "avoid": ["leverage", "robust"] }
}'
phdude authors learn researcher-a --from chapter-2.md chapter-3.md --approved
phdude authors consensus
```

Author voice profiles (PRD §30) live at `authors/<id>.yaml`, one per researcher. `add` writes a
new profile; the id must be `^[a-z0-9-]+$` and refuses to overwrite an existing file (`id` is a
researcher-chosen name, not content-derived like a knowledge object's). `project-consensus` is
reserved and cannot be created with `add`.

`learn` reads each `--from` path (relative to the current directory, not the workspace) and
recomputes the profile's `learned` block from exactly those texts: sentence-length mean and SD,
opening diversity, transition rate, first-person rate, hedge rate, paragraph density, and the
15 most frequent non-stopword terms of 6+ letters. Every field is an explicit, human-readable
number - never an opaque embedding (PRD §30). Learning again with more samples recomputes
`learned` from the new set; it does not average against the old one. Each path is merged into
`samples[]` by path - one entry per file, never a second copy on a rerun - recorded relative to
the workspace when it lives inside it and as an absolute path otherwise; `approved: true` is set
when `--approved` is passed and an entry already marked approved keeps it, so a sample can be
tracked before the researcher has actually signed off on it. Learning again from samples that
have not changed rewrites nothing at all, `learned_at` included, exactly as `consensus` does; it
records one event saying the voice was unchanged.

`consensus` merges every profile except `project-consensus` itself: categorical fields (tone,
sentence style, transitions, language) by majority vote, ties won by whichever profile was
read first; `terminology.preserve` by union; `terminology.avoid` by intersection (a word every
participant wants avoided); every numeric `learned` field by median across the profiles that
have run `learn`. It rewrites `authors/project-consensus.yaml` only when the merged content
differs from what is already there (`learned.learned_at` aside, since a timestamp is not
content), and proposes a Decision titled "Update project-consensus voice" with it - running it
again with nothing new to learn from leaves the file byte for byte as it was and proposes
nothing. The Decision's id is keyed on the voice it proposes, so recomputing a consensus you
have already been offered finds that same Decision instead of a second copy of it. Never approve that
Decision on the researcher's behalf.

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

A workspace written by a *newer* PhDude is the same problem from the other end, and this build
cannot migrate its way out of it. Reads warn with
`workspace version 3 is newer than this PhDude (2)`; the same writes exit 1 with that message
and the hint `upgrade phdude`.

`--dry-run` writes nothing and lists the files each step would rewrite. Because git is the only
undo for an in-place rewrite, `migrate` exits 3 on a dirty git tree unless `--force` is given; a
dry run is a read and stays available either way. Steps are idempotent, so running `migrate` on
an up-to-date workspace prints `Workspace is up to date (2)` and records no event.

### `phdude doctor`

Reports the Node version, whether git and `pdftotext` are available, per-parser
availability, whether the current directory is a workspace, its workspace version and whether
that version is `(current)`, `(needs migration → 2)` or `(newer than this phdude)`, whether
network access is enabled and the configured search providers, the cache
entry count, the discoverable packs and the schema
versions, plus warnings for anything missing. It is diagnostic only and never writes.

The `network:` and `providers:` lines read `.phdude/research-policy.yaml` without calling
anything: `network` is `enabled` only when that file sets `network.enabled: true`, and
`providers` lists the workspace's `providers:` array in order (or the default `openalex,
crossref, arxiv` when the file has none). This is the workspace's *active* list, not every
provider PhDude can search — `openalex`, `crossref`, `arxiv`, `semantic-scholar` and `pubmed`
are all registered in `src/adapters/search/index.js` and can be added to `providers:` to enable
them. See [SearchProvider](extending.md#searchprovider).

A policy file that is not valid YAML replaces both lines with
`policy: unreadable (malformed YAML: .phdude/research-policy.yaml)`, and `--json` reports it as
`policyError` with `network: null` and `providers: []`. `doctor` still exits 0 — printing the
built-in defaults there would answer the question with a fiction. Every other command that
reads the policy (`status`, `gaps`, `next`, `freshness`, `cite check`, `research`,
`research-fresh`) exits 2 with that same message and the hint `fix the file`.

A workspace with a manuscript also gets a `Manuscript:` block: the sections by status, the
sections that have a report in `manuscript/reports/`, and the sections whose file has been
edited outside PhDude since its last submit (`drift: none` when none has). Each drifted section
is a warning too. `--json` carries the same as `manuscript: { counts, reports[], drifted[] }`,
and `null` for a workspace with no manuscript.

It also lists every discoverable skill (core, applied packs, and the workspace's own
`.phdude/skills/`) with its source, declared network and workspace permissions, and any loader
warnings — one line each: `<name> (<source>) network=<none|allowed> workspace=<read,...>`. See
[Skill contract](extending.md#skill-contract). `--json` includes the same data as a `skills`
array of `{ name, source, permissions, reads, writes, warnings }`.

`source` is `workspace` only when the workspace's copy actually differs from the shipped file.
`init` copies every core skill into `.phdude/skills/`, so an untouched workspace would otherwise
report all of them as its own; the bytes are compared, and an unmodified copy stays `core`.

Being the command you run when something is wrong, `doctor` degrades rather than fails. A skill
whose `SKILL.md` cannot be loaded costs one warning naming that skill, and every other skill is
still listed. A skill that declares `permissions.network: allowed` while
`.phdude/research-policy.yaml` has not set `skills.allow_network: true` is listed with a warning
too. `phdude packs apply` turns that into a refusal (exit 3); `phdude init` instead withholds
the skill, naming it and the setting that would install it, and installs everything else.

### `phdude help`

Prints the usage summary and exits 0. `phdude --help` and `phdude -h` do the same. With
`--json` the summary comes back as `{"usage": "…"}`.

A bare `phdude`, an unknown command and an unparseable argument list are usage errors, not
help requests: they exit 1 and write the error to stderr, following the `--json` error
contract above, with the usage block appended in text mode only.

## Internal

`PHDUDE_FAKE_FETCH=<path>` is an internal, test-only hook. When it is set, `phdude research`
and `phdude research-fresh` build their providers' `fetch` from the JSON routes file at that
path instead of the network, so
the end-to-end tests can exercise the whole command offline. Each route is
`{ "match": "<substring of the URL>", "status": 200, "body": …, "bodyFile": "<path relative to
the routes file>", "headers": {…}, "times": N }`; an unmatched URL throws rather than falling
through to the real network. Nothing in a normal run reads this variable, and it is not part of
the CLI's supported surface.

# The research workspace

`phdude init` creates a plain git repository. Everything in it is YAML or Markdown you can
read, diff and merge without PhDude installed. Nothing is hidden in a database.

```
my-research/
├── phdude.yaml                   # project config (schema phdude.project v1)
├── AGENTS.md                     # shared agent instructions (Codex and any other host)
├── CLAUDE.md                     # Claude Code entry point
├── .claude/commands/phdude*.md   # slash commands wrapping the CLI
├── .phdude/
│   ├── constitution.yaml         # non-negotiable research rules
│   ├── research-policy.yaml      # evidence, sources, methodology preferences
│   ├── writing-policy.yaml
│   ├── citation-policy.yaml
│   ├── methodology-policy.yaml
│   ├── publication-policy.yaml
│   ├── author-profile.yaml
│   ├── templates.yaml            # the registered document templates
│   ├── skills/<name>/SKILL.md    # installed agent skills (PhDude-managed)
│   ├── skills-lock.yaml          # where every externally installed skill came from
│   ├── events.jsonl              # append-only audit log (committed)
│   └── cache/                    # extracted text, gitignored and disposable
├── authors/                      # per-researcher voice profiles (phdude authors)
│   ├── <id>.yaml                 # schema phdude.author-profile v1
│   ├── project-consensus.yaml    # written by `phdude authors consensus`
│   └── samples/<id>/*.md         # approved writing samples `learn` reads from
├── sources/                      # raw materials you drop in
├── knowledge/
│   ├── artifacts/  ART-*.yaml    # one per distinct file hash
│   ├── sources/    SRC-*.yaml    # bibliographic records
│   ├── claims/     CLAIM-*.yaml
│   ├── evidence/   EVID-*.yaml
│   ├── facts/      FACT-*.yaml
│   ├── results/    RESULT-*.yaml
│   ├── candidates/ CAND-*.yaml   # literature hits awaiting review, not yet sources
│   └── datasets/   DATASET-*.yaml # files under data/, hashed and profiled
├── research/
│   ├── questions/  RQ-*.yaml
│   ├── hypotheses/ H-*.yaml
│   ├── methods/    METH-*.yaml
│   └── searches/   SEARCH-*.yaml # what was asked, of whom, and when
├── decisions/      DEC-*.yaml
├── reviews/        REVIEW-*.yaml  # what a reviewer found, and what was decided about it
├── tables/         TABLE-*.yaml  # table declarations
│   └── out/                      # the rendered .md/.tex/.csv, generated
├── figures/        FIG-*.yaml    # figure declarations, alt text included
│   └── out/                      # what the generators wrote, generated
├── manuscript/
│   ├── manuscript.yaml           # schema phdude.manuscript v1: the plan and every section
│   ├── manuscript.<venue>.yaml   # the same sections adapted to a venue, by `phdude adapt --apply`
│   ├── <section>.md              # the prose, front matter + Markdown body
│   └── reports/<section>.yaml    # schema phdude.section-report v1: the last gate run
├── reports/health.yaml           # the last `phdude health --save`; latest only, for --trend
├── references.bib                # written by `phdude cite export`; derived, and gitignored
├── analysis/       ANALYSIS-*.yaml # declared analysis scripts and their runs
│   └── out/                      # where a run's results.json and files land
├── data/                         # your data files; registered ones become DATASET records
├── templates/                    # document templates; `phdude template add` files them by kind
│   └── docx|pptx|latex/          #   the copies the registry made, named after the template
├── outputs/<slug>/               # what `phdude build` and `phdude present outline` deliver, generated
│   ├── manuscript.<ext>          # the document: .md, .docx, .pdf, .tex or .html
│   ├── references.bib            # the citation registry, regenerated for this build
│   ├── figures/                  # the figures the prose shows, converted where the venue asks
│   └── outline.md|.pptx          # the presentation outline
└── .gitignore
```

`analysis/out/`, `tables/out/`, `figures/out/` and `outputs/` are gitignored, and so is
`.phdude/cache/`.
What lands in them is reproducible from the record next to it — the run already carries the hash
of every file it wrote — so committing them would be committing the same thing twice. Everything
else in the tree is meant to be read in a diff.

## `phdude.yaml`

```yaml
schema: phdude.project
version: 1
workspace_version: 5
title: Adaptive scheduling in edge clusters
language: en
fields: [computer-science]
methods: [quantitative]
venues: [ieee]
outputs: [thesis]
mode: full
agents: [claude-code, codex]
packs_recommended: [quantitative]
```

`fields`, `methods` and `venues` are applied packs. `packs_recommended` is what `phdude packs
detect` suggested; it is a recommendation until you run `phdude packs apply`. A venue in
`venues` is one the project is aiming at; which one the manuscript actually targets is
`target_profile` in `manuscript.yaml`, set by `phdude profile use`.

### `workspace_version`

`version: 1` is the schema of this file. `workspace_version` is the shape of the whole
directory, and it is what `phdude migrate` moves forward. A workspace without the field is
version 1 (everything v0.1 wrote); the current version is 5. Versioning the workspace rather
than each object keeps an additive field — `provenance`, `contradicts` — from turning into a
breaking change for every reader; see [ADR 6](adr/0006-workspace-versioning-and-migrations.md).

Reads keep working on an out-of-date workspace and say `workspace needs migration (1 → 5)`.
Writes stop until you run `phdude migrate`, which is deliberately a command you run rather than
something that happens to your files while you were asking for something else.

## What is yours and what PhDude manages

`phdude init` is re-runnable, and it treats three groups of files differently.

| Path | On re-run |
|---|---|
| `phdude.yaml`, `.phdude/*.yaml`, and everything under `knowledge/`, `research/`, `decisions/`, `sources/`, `authors/`, `manuscript/` | yours; never overwritten |
| `.gitignore` | yours; only the missing default lines are appended |
| `AGENTS.md`, `CLAUDE.md`, `.claude/commands/*` | rewritten only while they carry the `phdude:managed` marker on the first line or in their front matter |
| the installed skills under `.phdude/skills/` | PhDude-managed; refreshed every time, and a changed file is reported under `updated` |

So a local edit to a shipped skill is overwritten by the next `init` or upgrade. Project
guidance that has to survive belongs in the policy files under `.phdude/`, or in a workspace
pack under `.phdude/packs/<kind>/<name>/`. See [docs/extending.md](extending.md).

## Canonical objects

Every object carries `schema`, `version`, `id`, `created`, `actor` and free-form `tags[]`.

| Object | Id | Key fields |
|---|---|---|
| Artifact | `ART-<hash10>` | `path`, `paths[]`, `hash`, `bytes`, `mime`, `kind`, `extracted`, `role` |
| Source | `SRC-<hash10>` | `title`, `authors[]`, `year`, `venue`, `doi`, `url`, `type`, `artifacts[]`, `bibkey?`, `abstract?`, `keywords[]?`, `identifiers?{doi,isbn,arxiv,pmid,url}`, `provenance?` |
| Claim | `CLAIM-<hash10>` | `statement`, `kind`, `supported_by[]`, `questions[]`, `sections[]`, `provenance` |
| Evidence | `EVID-<hash10>` | `source`, `locator`, `excerpt`, `strength`, `provenance` |
| Fact | `FACT-<hash10>` | `key`, `value`, `unit`, `from {artifact, locator}` |
| Result | `RESULT-<hash10>` | `summary`, `from`, `values{}`, `ext.analysis?{key,run_at,unit}`, `superseded_by?` |
| Analysis | `ANALYSIS-<hash10>` | `name`, `runtime`, `script`, `args[]`, `inputs[]`, `outputs{results,files[]}`, `params`, `runs[]` |
| Dataset | `DATASET-<hash10>` | `path`, `hash`, `bytes`, `format`, `profile{rows,columns[]}`, `description?`, `license?`, `sensitive`, `versions_of?`, `latest` |
| Table | `TABLE-<hash10>` | `name`, `caption`, `source{result}\|{dataset,columns?,limit?}`, `columns[]`, `formats[]`, `outputs{md,latex,csv,xlsx,docx}`, `runs[]` |
| Figure | `FIG-<hash10>` | `name`, `caption`, `alt`, `generator{runtime,script,args[]}`, `inputs[]`, `outputs[{path,format}]`, `runs[]` |
| ResearchQuestion | `RQ-<n>` | `text`, `objectives[]` |
| Hypothesis | `H-<n>` | `text`, `questions[]` |
| Method | `METH-<hash10>` | `name`, `design`, `paradigm`, `sampling`, `instruments[]`, `analysis[]`, `limitations[]`, `questions[]` |
| Decision | `DEC-<hash10>` | `title`, `rationale`, `proposed_by`, `approved_by[]`, `status`, `change`, `affects[]` |
| Candidate | `CAND-<hash10>` | `provider`, `providers[]`, `external_id`, `title`, `authors[]`, `year`, `venue`, `doi`, `url`, `abstract`, `type`, `open_access`, `cited_by`, `query`, `question`, `search`, `score`, `score_parts`, `needs_approval`, `state`, `reason?`, `accepted_as?` |
| Search | `SEARCH-<hash10>` | `query`, `question`, `providers[]`, `filters`, `runs[]`, `last_run` |
| Review | `REVIEW-<hash10>` | `kind`, `target`, `severity`, `message`, `evidence[]`, `suggested_command?`, `status`, `by`, `mode`, `reason?`, `resolved?` |

Ids are derived from content, so the same claim added twice is one file. See
[ADR 3](adr/0003-content-derived-ids.md). A candidate's identity is the **work**, not the
provider that returned it: its DOI when it has one (`doi:<lowercased doi>`), otherwise its
normalized title and year (`title:<title>|<year>`). Searching the same work again through a
different provider list therefore lands on the same `CAND-` record instead of a second one. A
search's identity is its normalized query and the question it was run for.

## Candidates and searches

`phdude research` writes both, and neither is knowledge yet.

A **Candidate** is one literature hit a provider returned. It is not a Source: nothing enters
the citation registry until the researcher accepts it, and `state` says where it stands —
`candidate` (unreviewed), `accepted` (with `accepted_as` naming the `SRC-` id it became), or
`dismissed` (with a `reason`). `providers[]` lists every provider that returned the same work,
and `ext.ids` keeps their own ids for it; `needs_approval: true` marks a preprint the policy
says the researcher has to approve explicitly.

Two providers returning the same work produce one candidate. The first provider in the run owns
the record — its `provider` and `external_id` are the ones kept — but a field it left empty
(`doi`, `url`, `venue`, `abstract`, `year`, `cited_by`, `open_access`) is filled from another
provider that did report it. A field it *did* report is never overwritten, so a candidate is
always one provider's account of a work plus whatever it did not know. `score_parts` explains the ranking (provider
rank, citation count, recency) so the order is auditable rather than mysterious.

A **Search** is the record of asking. `runs[]` appends one entry per provider call — `at`,
`provider`, `count` and how many of those results were `new` — so a query re-run months later
extends one history instead of minting a second record. `filters` snapshots what the run
applied, and `last_run` is what freshness is measured against — by `phdude freshness`, by the
`stale-search` gap and `next` rule, and by `phdude research-fresh`, which re-runs a stale search
from exactly that snapshot.

A stored candidate is never rewritten by a later run, with one exception: a work recorded
without a DOI, because the provider that returned it did not report one, takes the DOI a later
run learns. Its identity moves from the title key to the DOI key, so `doi`, `url`, `ext.ids`
and `providers[]` are filled in and the record keeps the id it already has. It still counts as
already known, not as a new candidate, and its `state` and `reason` are untouched.

## Accepting a candidate

`phdude research accept CAND-…` is the only path from a candidate into the citation registry.
The Source it writes carries what the providers actually reported — `title`, `authors`, `year`,
`venue`, `abstract`, `type`, and `identifiers` holding only the ids some provider returned
(`doi`, `url`, `arxiv`, `pmid`) — plus two records of where it came from:

```yaml
provenance:
  method: imported
  derived_from: []
ext:
  research:
    candidate: CAND-9574a4d19b
    provider: openalex
    external_id: W4390110022
    accepted_by:
      researcher: ada
      agent: cli
```

`derived_from` is empty because nothing was read out of an ingested artifact: the record came
from a provider, not from a document in `sources/`. The candidate moves to `accepted` and
records `accepted_as`. If the workspace already records that Source — the same normalized title
and year — the candidate is linked to it and the existing record is left exactly as it is.

## Reviews

`phdude review <kind>` assembles the context a review is done from; `phdude review submit` records
what the reviewer said as `REVIEW-` objects under `reviews/`. A review is not knowledge: it has no
`state` from the knowledge lifecycle, only its own `status`, and nothing downstream ever rests on
it the way a claim rests on evidence.

A review's identity is what was said about what — its `kind`, its `target` and its `message` —
so the same finding submitted twice lands on the record that already exists. Submitting never
rewrites one, verdict included: re-running a review must not reopen a finding the researcher
already dismissed.

`target` is an object id, `manuscript:<section>`, or `project`. `evidence[]` lists the ids the
finding rests on, and `review submit` refuses a file naming an id or a section the workspace does
not have. `by` is the actor the review is recorded against and `mode` the workspace review mode
at the time, because a finding written under `ruthless` and one written under `lite` do not mean
the same thing.

`status` moves one way: `open` becomes `accepted` or `dismissed`, and only an `accepted` finding
becomes `resolved`. Those verdicts are the researcher's, exactly like a Decision's approval.
`severity` is `block`, `major`, `minor` or `note` and is never rewritten — `ruthless` mode
promotes `minor` to `major` and `major` to `block` where a verdict is computed (`phdude next`,
`phdude ready`), so changing the mode changes the reading and not one record.

## Author voice profiles

`authors/<id>.yaml` (`schema: phdude.author-profile`, PRD §30) is not a canonical object: its
id is a researcher-chosen slug (`researcher-a`, `^[a-z0-9-]+$`), not content-derived, so
`phdude authors add` refuses to overwrite an existing one rather than treating a repeat as a
no-op. It records style preferences by hand (`tone`, `sentences`, `paragraphs`, `transitions`,
`terminology.{preserve,avoid}`) and, once `phdude authors learn <id> --from <path…>` has run
against approved writing samples, a `learned` block of explicit descriptive statistics —
sentence-length mean and SD, opening diversity, transition rate, first-person rate, hedge rate,
paragraph density, and the most frequent preserved terminology. Every `learned` field is a
plain number or word list, never an opaque embedding: a researcher can read what PhDude
inferred and correct it by editing the profile or running `learn` again. Each sample path
`learn` reads is appended to `samples[]`, relative to the workspace when it lives inside it and
absolute otherwise, with `approved: true` only when `--approved` was passed.

`phdude authors consensus` merges every profile except `project-consensus` itself: categorical
fields (tone, sentence style, transitions, language) by majority vote — a tie keeps whichever
profile was read first — `terminology.preserve` by union, `terminology.avoid` by intersection,
and every numeric `learned` field by median across the profiles that have actually run `learn`.
It writes `authors/project-consensus.yaml` only when the merged content differs from what is
already there, and proposes a Decision titled "Update project-consensus voice" with it, naming
the participating author ids so the researcher can see whose profiles moved the result. A rerun
with nothing new to merge leaves the file exactly as it was and proposes nothing. A manuscript names its active
voice with `writing.primary_voice: <id>` or `writing.voice: project-consensus` (PRD §30.2); the
Author Voice Check gate (v0.4's writing pipeline) compares a draft's own statistics against
that profile's `learned` fields and reports deviations rather than silently rewriting.

## Knowledge states

`candidate` → `supported` → `canonical`, with `disputed` and `rejected` alongside.

- **`candidate`** — anything the agent just added. Must be hedged in prose.
- **`supported`** — evidence exists and a human has looked at it.
- **`canonical`** — established project knowledge. Only reachable through an approved
  Decision that names the object in `affects`.
- **`disputed`** — a conflict is open; never silently pick a side. Claims reach this state
  automatically via `phdude link --contradicts` (below), never by hand.
- **`rejected`** — do not cite as knowledge.

The state is not decoration. It tells the agent how strongly it is allowed to write about
the object (PRD §3.13).

## Fact conflicts

Two Facts sharing a `key` but reporting different values from different artifacts are a
conflict, computed on read by `status` and `next`. Rejected Facts are ignored.

A conflict counts as resolved only when an approved Decision names that `key` in
`change.fact_key` **and** lists every non-rejected Fact of that key in `affects`. Adding a
Fact the Decision never saw therefore reopens the conflict rather than inheriting the old
resolution, so a later revision of a source can never be silently absorbed into a decision
nobody made about it. `phdude next` suggests a `decide propose` command whose `--affects`
already lists every Fact in the group.

## Claim contradictions

`phdude link CLAIM-a --contradicts CLAIM-b` (PRD §3.5, §38) records that two claims cannot
both be true. The relation is symmetric - `contradicts` is written to both claims - and each
side moves to `disputed` when its current state allows it (`candidate`/`supported`/`canonical`
all do; `rejected` and already-`disputed` claims are left alone). A `canonical` claim can be
disputed this way with no Decision required: surfacing a contradiction is proactive by design
(PRD §3.3), unlike changing what a canonical claim says.

`phdude status` lists a disputed pair while neither side has been `rejected`. A single
Decision must not rehabilitate both sides of a dispute, so resolving one names a survivor: an
approved Decision whose `change.resolves_contradiction` names both claims in the pair and
`change.survivor` names which one wins. The survivor cannot be promoted until every other claim
the Decision names that it still contradicts is `rejected` - reject the loser first with
`phdude promote CLAIM-b --to rejected` (no Decision needed for that step), then
`phdude promote CLAIM-a --to supported --decision DEC-x` moves the survivor on. Promoting the
loser with the same Decision is refused, naming the survivor instead. The `contradicts` entry
itself is never removed; once resolved it stays as history of the dispute.

## Provenance and the audit trail

Claims and evidence carry a `provenance` block saying how the record came to exist:

```yaml
provenance:
  method: agent-extraction # or manual, or imported
  derived_from:
    - ART-35146e2f6d
```

`method` is `manual` when a human typed the object at the CLI, `agent-extraction` when an
agent host recorded it, and `imported` for objects that predate the field (`phdude migrate`
fills those in). `derived_from` lists the artifacts behind it: for evidence, the artifact it
cites or the artifacts of its source; for a claim, the union of its evidence's. `phdude
knowledge trace` prints it, which is how "who says so, and from what?" gets answered without
opening a file.

`.phdude/events.jsonl` gets exactly one line per mutating command:

```json
{"ts":"2026-09-07T09:12:44.101Z","op":"add","actor":{"researcher":"ada","agent":"claude-code"},"ids":["CLAIM-3d035aa05b"],"summary":"claim added"}
```

Accepting or dismissing a candidate writes one `research` event
(`accepted CAND-… as SRC-…`, or `dismissed CAND-…: <reason>`), and `phdude edit` writes one
`edit` event naming the fields that changed.

Installing or removing an external skill writes one `skills` event
(`installed <name> from <source>`, or `removed <name>`).

A network call is audited the same way, one `search` event per provider call:

```json
{"ts":"2026-09-07T10:02:11.004Z","op":"search","actor":{"researcher":"ada","agent":"cli"},"ids":["SEARCH-7c2d4e6a10"],"summary":"openalex: \"open science practices\" → 3 results"}
```

The summary carries the provider, the query that left the machine and a count — never a
result. A provider call that failed is recorded too, as `→ failed`: the query still left the
machine, so the log still says so.

It is committed, append-only, and independent of git history, so a rebase cannot erase who
recorded what. Git history complements it with the full content of each change.

## The Research Health report

`phdude health` computes the eight-dimension Research Health score from the workspace on every
run and prints the observations behind each number; nothing is stored unless the researcher
asks. `phdude health --save` writes `reports/health.yaml` and records one `health` event:

```yaml
schema: phdude.health
version: 1
at: 2026-09-07T12:00:00Z
overall: 62
dimensions:
  - key: literature-coverage
    score: 67
    weight: 1
```

The overall, and each dimension's key, score and weight — and nothing else. The observations are
recomputed from the workspace every run, so storing them would only be storing a second copy of
something that can go out of date. There is one saved report, not a series: each save replaces
the last, and `phdude health --trend` measures this run against it. The formulas, and the rule
that none of them is ever a detector or "humanity" score, are in ADR 0011.

## The manuscript

`manuscript/` holds the prose and the plan behind it (PRD §33):

```text
manuscript/
├── manuscript.yaml     # title, language, voice, one entry per section
├── introduction.md     # the prose, with a small front matter block
├── methods.md
└── reports/
    └── introduction.yaml   # the gate report behind the last accepted submit
```

`phdude manuscript init` writes `manuscript.yaml` with the six standard sections — abstract,
introduction, methods, results, discussion, conclusions — all `planned`. Each entry carries its
`id`, `title`, `file`, `order`, `status`, `hash`, the `claims` and `questions` it covers, and
`approved_by` once a decision approves it. A section file is written the first time a draft
passes `phdude manuscript submit`, never by `init`.

Every section file starts with four flat keys:

```markdown
---
section: introduction
status: draft
hash: 3a7bd3e2…
updated: 2026-09-07T10:00:00.000Z
---

# Introduction

SMEs adopt AI slowly [@zeta2020study].
```

The `hash` is the sha256 of the body with the front matter removed, line endings normalized and
trailing whitespace dropped, so reformatting a file does not look like a rewrite. It is what
tells `phdude manuscript show`, `phdude prose <section>` and `phdude doctor` that a section file
has been edited outside PhDude since its last submit; each of them says so plainly, naming the
section, rather than presenting the new text under the old record.

`manuscript/reports/<section>.yaml` records what the gates found on the submit that was
accepted: the section, the hash it applies to, the timestamp, one row per gate with its finding
count, the prose scores, and the warning and block counts. It carries counts, never prose. The
next accepted submit rewrites it, and so does `phdude prose <section>`, which recomputes every
field together so the numbers always describe the body the hash names.

Everything under `manuscript/` is yours, but it is not hand-edited: prose reaches a section
through `phdude manuscript submit <section> --file <draft.md>`, which runs the writing gates
first and writes nothing when one blocks. A section that has been approved is only editable
after `phdude manuscript reopen`, which is the approval being withdrawn on the record rather
than quietly overwritten.

Drafting a section starts one step earlier, with `phdude write <section>`. It assembles the
writing context — the section's claims with their evidence, the citation keys, the policy, the
voice profile and the verb table — into `.phdude/cache/writing/<section>/context.md` and prints
the contract the draft has to meet. `phdude deslop <section>` is the revision half: it reports
what to change, and takes the revision back through the gates with meaning preservation on.
Neither writes prose; both leave that to `submit` and to `deslop --file`.

## The templates registry

`.phdude/templates.yaml` (schema `phdude.templates` v1) is the list of document
templates the workspace holds: one entry per template with its `name`, its `kind` (`docx`,
`pptx` or `latex`), the `path` of the copy under `templates/<kind>/`, the `hash` of its bytes,
and the profile it is bound `for` once `phdude template use` says so. A build and
`phdude present outline` read it to decide which file to hand the renderer.

The registry is a record, not a cache: it is committed, and `phdude template check` reports a
template whose bytes no longer hash to what was registered. The templates themselves are yours —
a university's thesis DOCX, a conference's LaTeX class — and PhDude never edits one.

## The skills lock

`.phdude/skills-lock.yaml` (schema `phdude.skills-lock` v1) records the provenance of every skill
`phdude skills install` brought in from outside the workspace: its `name`, the `source` it came
from (an absolute directory or an https URL), the `hash` of its files, and `installed_at`. The
shipped skills and the ones a pack carries are not in it — those come with PhDude and with the
pack, and `phdude init` and `phdude packs apply` keep them in step.

The `hash` is one sha256 over the tree's sorted `<path> <sha256>` lines, so an edited byte and a
renamed file both move it. `phdude doctor` and `phdude skills list` compare it against what is on
disk and report a skill that changed after it was installed — an edited skill is not the skill
that was reviewed. Like the templates registry, the lock is a record rather than a cache: it is
committed, and PhDude never runs anything inside a skill it copied.

## Adapted manuscripts

`phdude adapt --to <venue> --apply` writes `manuscript/manuscript.<venue>.yaml`: a second
manuscript, same schema, whose sections carry the venue's ids, titles and order and point at the
**same** `.md` files as `manuscript.yaml`. Only the plan is new — no prose is copied, and nothing
under `manuscript/` is rewritten. A section over the venue's word limit comes out `revised` and
without its `approved_by`, because the approval was for text at a length that venue will not take.

It is canonical, not derived: it is committed, and it goes stale the moment the canonical
manuscript's structure changes. Re-running `adapt --apply` rewrites it; a run that would write
exactly what is already there writes nothing and records no event.

What it is **not**, yet, is a build input. `phdude build` reads `manuscript/manuscript.yaml` and
takes its venue from `--profile` or `target_profile`, so building for a venue you have adapted to
still builds the canonical section list against that venue's profile. The adapted file is the
record of the mapping and the work list it implies: which sections the venue renamed, and which
ones came back `revised` and still owe a revision.

## Derived files

Three things in the workspace are outputs rather than knowledge, and all of them can be deleted
and rebuilt: `.phdude/cache/` (below), `outputs/` (what `phdude build` and `phdude present outline`
write), and `references.bib` / `references.json`, written at the workspace root by
`phdude cite export`. Nothing under `outputs/` is ever read back as knowledge or cited: it is
rebuilt from the manuscript, the knowledge graph and the profile, so editing it by hand loses
the edit at the next build.

The default `.gitignore` covers both, since committing a file that is one command away from
being regenerated only creates merge conflicts. The export covers every source, cited or not. It
records no event, because nothing about the research changed when you wrote it, and it is never
the thing you cite: a claim rests on an `EVID-` id which names a `SRC-` id, and the bibkey is
only how that source is printed. An export older than the sources it came from is stale — re-run
`phdude cite check`, then export again, rather than editing the `.bib` by hand.

## The cache

`.phdude/cache/ART-<id>/` holds `manifest.json`, `text.md`, `sections/*.md` and
`tables/*.csv` extracted from the source file. It is gitignored and disposable: delete it
and `phdude ingest --force` rebuilds it.

`.phdude/cache/writing/<section>/` holds `context.md`, the writing context `phdude write`
assembled, and `report.json`, the full gate report behind the last accepted `submit` or
`deslop` — every finding, warnings included, where `manuscript/reports/<section>.yaml` keeps
only the canonical summary. A blocked run writes neither: it leaves the workspace as it was.

`.phdude/cache/build/<slug>/` holds one `<format>.json` and one `<format>.md` per format
built: the record of every input hash behind the last build, and the Markdown that build handed
the renderer. The record is what makes a second `phdude build` report `up to date` instead of
rendering again; delete the directory and the next build renders from scratch. Nothing in
`outputs/` is scratch — the assembled source lives here so that everything a build delivers can
be sent to a co-author as it stands.

Agents read the cache section by section rather than loading whole documents, which is how
PhDude stays inside a context budget on projects with hundreds of sources (PRD §70).

## Collaboration

The workspace is a git repository, so collaboration is branches, pull requests and merges.
Two researchers adding different claims produce two new files that merge cleanly. Editing
the same object conflicts on that one file, which is the honest outcome and the point where
a Decision belongs. See [ADR 2](adr/0002-git-workspace-entity-per-file.md).

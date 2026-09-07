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
│   ├── skills/<name>/SKILL.md    # installed agent skills (PhDude-managed)
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
│   └── candidates/ CAND-*.yaml   # literature hits awaiting review, not yet sources
├── research/
│   ├── questions/  RQ-*.yaml
│   ├── hypotheses/ H-*.yaml
│   ├── methods/    METH-*.yaml
│   └── searches/   SEARCH-*.yaml # what was asked, of whom, and when
├── decisions/      DEC-*.yaml
├── manuscript/
│   ├── manuscript.yaml           # schema phdude.manuscript v1: the plan and every section
│   ├── <section>.md              # the prose, front matter + Markdown body
│   └── reports/<section>.yaml    # schema phdude.section-report v1: the last gate run
├── references.bib                # written by `phdude cite export`; derived, and gitignored
├── data/ analysis/ figures/ tables/ templates/ outputs/
└── .gitignore
```

## `phdude.yaml`

```yaml
schema: phdude.project
version: 1
workspace_version: 2
title: Adaptive scheduling in edge clusters
language: en
fields: [computer-science]
methods: [quantitative]
outputs: [thesis]
mode: full
agents: [claude-code, codex]
packs_recommended: [quantitative]
```

`fields` and `methods` are applied packs. `packs_recommended` is what `phdude packs detect`
suggested; it is a recommendation until you run `phdude packs apply`.

### `workspace_version`

`version: 1` is the schema of this file. `workspace_version` is the shape of the whole
directory, and it is what `phdude migrate` moves forward. A workspace without the field is
version 1 (everything v0.1 wrote); the current version is 2. Versioning the workspace rather
than each object keeps an additive field — `provenance`, `contradicts` — from turning into a
breaking change for every reader; see [ADR 6](adr/0006-workspace-versioning-and-migrations.md).

Reads keep working on an out-of-date workspace and say `workspace needs migration (1 → 2)`.
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
| Result | `RESULT-<hash10>` | `summary`, `from`, `values{}` |
| ResearchQuestion | `RQ-<n>` | `text`, `objectives[]` |
| Hypothesis | `H-<n>` | `text`, `questions[]` |
| Method | `METH-<hash10>` | `name`, `design`, `paradigm`, `sampling`, `instruments[]`, `analysis[]`, `limitations[]`, `questions[]` |
| Decision | `DEC-<hash10>` | `title`, `rationale`, `proposed_by`, `approved_by[]`, `status`, `change`, `affects[]` |
| Candidate | `CAND-<hash10>` | `provider`, `providers[]`, `external_id`, `title`, `authors[]`, `year`, `venue`, `doi`, `url`, `abstract`, `type`, `open_access`, `cited_by`, `query`, `question`, `search`, `score`, `score_parts`, `needs_approval`, `state`, `reason?`, `accepted_as?` |
| Search | `SEARCH-<hash10>` | `query`, `question`, `providers[]`, `filters`, `runs[]`, `last_run` |

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
It writes `authors/project-consensus.yaml` on every run, and proposes a Decision titled "Update
project-consensus voice" only when the merged content changed, naming the participating author
ids so the researcher can see whose profiles moved the result. A manuscript names its active
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

A network call is audited the same way, one `search` event per provider call:

```json
{"ts":"2026-09-07T10:02:11.004Z","op":"search","actor":{"researcher":"ada","agent":"cli"},"ids":["SEARCH-7c2d4e6a10"],"summary":"openalex: \"open science practices\" → 3 results"}
```

The summary carries the provider, the query that left the machine and a count — never a
result. A provider call that failed is recorded too, as `→ failed`: the query still left the
machine, so the log still says so.

It is committed, append-only, and independent of git history, so a rebase cannot erase who
recorded what. Git history complements it with the full content of each change.

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
tells a later version which sections still need their gates re-run.

`manuscript/reports/<section>.yaml` records what the gates found on the submit that was
accepted: the section, the hash it applies to, the timestamp, one row per gate with its finding
count, the prose scores, and the warning and block counts. It carries counts, never prose, and
it is rewritten by the next accepted submit.

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

## Derived files

Two things in the workspace are outputs rather than knowledge, and both can be deleted and
rebuilt: `.phdude/cache/` (below) and `references.bib` / `references.json`, written at the
workspace root by `phdude cite export`.

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

Agents read the cache section by section rather than loading whole documents, which is how
PhDude stays inside a context budget on projects with hundreds of sources (PRD §70).

## Collaboration

The workspace is a git repository, so collaboration is branches, pull requests and merges.
Two researchers adding different claims produce two new files that merge cleanly. Editing
the same object conflicts on that one file, which is the honest outcome and the point where
a Decision belongs. See [ADR 2](adr/0002-git-workspace-entity-per-file.md).

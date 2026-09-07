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
├── authors/                      # per-researcher voice profiles (populated in v0.4)
├── sources/                      # raw materials you drop in
├── knowledge/
│   ├── artifacts/  ART-*.yaml    # one per distinct file hash
│   ├── sources/    SRC-*.yaml    # bibliographic records
│   ├── claims/     CLAIM-*.yaml
│   ├── evidence/   EVID-*.yaml
│   ├── facts/      FACT-*.yaml
│   └── results/    RESULT-*.yaml
├── research/
│   ├── questions/  RQ-*.yaml
│   ├── hypotheses/ H-*.yaml
│   └── methods/    METH-*.yaml
├── decisions/      DEC-*.yaml
├── data/ analysis/ figures/ tables/ manuscript/ templates/ outputs/
└── .gitignore
```

## `phdude.yaml`

```yaml
schema: phdude.project
version: 1
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

## What is yours and what PhDude manages

`phdude init` is re-runnable, and it treats three groups of files differently.

| Path | On re-run |
|---|---|
| `phdude.yaml`, `.phdude/*.yaml`, and everything under `knowledge/`, `research/`, `decisions/`, `sources/` | yours; never overwritten |
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
| Source | `SRC-<hash10>` | `title`, `authors[]`, `year`, `venue`, `doi`, `url`, `type`, `artifacts[]` |
| Claim | `CLAIM-<hash10>` | `statement`, `kind`, `supported_by[]`, `questions[]`, `sections[]`, `provenance` |
| Evidence | `EVID-<hash10>` | `source`, `locator`, `excerpt`, `strength`, `provenance` |
| Fact | `FACT-<hash10>` | `key`, `value`, `unit`, `from {artifact, locator}` |
| Result | `RESULT-<hash10>` | `summary`, `from`, `values{}` |
| ResearchQuestion | `RQ-<n>` | `text`, `objectives[]` |
| Hypothesis | `H-<n>` | `text`, `questions[]` |
| Method | `METH-<hash10>` | `name`, `design`, `paradigm`, `sampling`, `instruments[]`, `analysis[]`, `limitations[]`, `questions[]` |
| Decision | `DEC-<hash10>` | `title`, `rationale`, `proposed_by`, `approved_by[]`, `status`, `change`, `affects[]` |

Ids are derived from content, so the same claim added twice is one file. See
[ADR 3](adr/0003-content-derived-ids.md).

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

`phdude status` lists disputed pairs while at least one side is still `disputed`. A single
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

It is committed, append-only, and independent of git history, so a rebase cannot erase who
recorded what. Git history complements it with the full content of each change.

## The cache

`.phdude/cache/ART-<id>/` holds `manifest.json`, `text.md`, `sections/*.md` and
`tables/*.csv` extracted from the source file. It is gitignored and disposable: delete it
and `phdude ingest --force` rebuilds it.

Agents read the cache section by section rather than loading whole documents, which is how
PhDude stays inside a context budget on projects with hundreds of sources (PRD §70).

## Collaboration

The workspace is a git repository, so collaboration is branches, pull requests and merges.
Two researchers adding different claims produce two new files that merge cleanly. Editing
the same object conflicts on that one file, which is the honest outcome and the point where
a Decision belongs. See [ADR 2](adr/0002-git-workspace-entity-per-file.md).

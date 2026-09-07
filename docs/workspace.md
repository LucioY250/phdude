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
│   ├── skills/<name>/SKILL.md    # the installed agent skills
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
│   └── hypotheses/ H-*.yaml
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

## Canonical objects

Every object carries `schema`, `version`, `id`, `created`, `actor` and free-form `tags[]`.

| Object | Id | Key fields |
|---|---|---|
| Artifact | `ART-<hash10>` | `path`, `paths[]`, `hash`, `bytes`, `mime`, `kind`, `extracted`, `role` |
| Source | `SRC-<hash10>` | `title`, `authors[]`, `year`, `venue`, `doi`, `url`, `type`, `artifacts[]` |
| Claim | `CLAIM-<hash10>` | `statement`, `kind`, `supported_by[]`, `questions[]`, `sections[]` |
| Evidence | `EVID-<hash10>` | `source`, `locator`, `excerpt`, `strength` |
| Fact | `FACT-<hash10>` | `key`, `value`, `unit`, `from {artifact, locator}` |
| Result | `RESULT-<hash10>` | `summary`, `from`, `values{}` |
| ResearchQuestion | `RQ-<n>` | `text`, `objectives[]` |
| Hypothesis | `H-<n>` | `text`, `questions[]` |
| Decision | `DEC-<hash10>` | `title`, `rationale`, `proposed_by`, `approved_by[]`, `status`, `change`, `affects[]` |

Ids are derived from content, so the same claim added twice is one file. See
[ADR 3](adr/0003-content-derived-ids.md).

## Knowledge states

`candidate` → `supported` → `canonical`, with `disputed` and `rejected` alongside.

- **`candidate`** — anything the agent just added. Must be hedged in prose.
- **`supported`** — evidence exists and a human has looked at it.
- **`canonical`** — established project knowledge. Only reachable through an approved
  Decision that names the object in `affects`.
- **`disputed`** — a conflict is open; never silently pick a side.
- **`rejected`** — do not cite as knowledge.

The state is not decoration. It tells the agent how strongly it is allowed to write about
the object (PRD §3.13).

## Provenance and the audit trail

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

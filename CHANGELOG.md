# Changelog

All notable changes to PhDude are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and PhDude adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] — 2026-09-07

The Co-Author. PhDude does not write prose — the agent still does that — but a draft now has to
get past the workspace before it becomes a section of the manuscript. Six deterministic gates run
on every submit, a blocking finding writes nothing at all, and a section reaches `approved` only
through a Decision a researcher approved by name. **Nothing here computes, accepts or optimizes
for an AI-detector score, and nothing ever will** (PRD §30c). See
[ADR 8](docs/adr/0008-writing-pipeline-and-no-detector-rule.md).

### Added

- **The manuscript model.** `phdude manuscript init|list|show <s>|status|submit <s> --file f
  [--revision] [--allow-additions]|approve <s> --decision DEC-id|reopen <s>` writes
  `manuscript/manuscript.yaml` (`phdude.manuscript` v1) with the six standard sections as
  `planned`, and moves each one `planned → draft → revised → approved`. A section file carries a
  four-key front matter and the sha256 of its body with line endings normalized and trailing
  whitespace dropped, so reformatting a file does not read as a rewrite.
- **Six writing gates**, each returning findings located to a line. `gate-citations`: every
  `[@key]` resolves to a recorded source, and a dismissed candidate may not be cited.
  `gate-evidence`: every marker names something real, a `rejected` claim may not be asserted, a
  verb may not outrun the claim's state or its evidence strength, and an unmarked numeral of two
  or more digits warns. `gate-prose`: nine rules over the text, reporting in `full` mode and
  blocking in `ruthless`. `gate-voice`: the draft's statistics against the active profile.
  `gate-meaning`: on a revision only. `gate-profile`: the venue's sections and word limits.
- **Meaning preservation.** `gate-meaning` extracts four multisets from the old and the new text
  — claim ids, citation keys, numerals and negation cues — and blocks a revision that dropped any
  of them. Cues rather than whole sentences, so a negated sentence can be reworded and cannot
  quietly lose its "not". An added claim or citation blocks too, unless `--allow-additions`.
- **A blocked submit writes nothing.** Not the section file, not the manuscript entry, not the
  cache report, not an event. The findings reach the researcher through the error with their line
  numbers, and exit code 2.
- **`phdude write <section> [--voice id] [--budget chars]`** assembles the writing context of
  PRD §70 into `.phdude/cache/writing/<section>/context.md`, in priority order and within a
  character budget: the section's purpose, the canonical project facts, its claims with state and
  strongest evidence, the citation keys that resolve, the writing policy, the voice profile, and
  the verb table for the states present. It prints what was left out for budget and the contract
  the draft must meet. It writes cache and records no event.
- **`phdude deslop <section> [--file f] [--allow-additions]`.** Without a file, the section's
  prose observations plus the revision contract: what to change, and the explicit list of what a
  rewrite may not touch. With a file, the revision through every gate, recorded as `revised` only
  when the meaning survived.
- **`phdude prose <section> | --file <path> [--lang c]`** — the Academic Prose Quality report of
  PRD §39.1: six sub-scores from documented formulas over counted observations, the aggregate as
  their weighted mean, and every observation with its line and what to do about it. With a section
  it reads the evidence graph, so Evidence Alignment and Epistemic Precision are real numbers, and
  it stores the scores in `manuscript/reports/<section>.yaml`. With `--file` it needs no
  workspace. It reports and never blocks; the exit code is always 0.
- **Author voice profiles.** `phdude authors list|show <id>|add --json|learn <id> --from <path…>
  [--approved]|consensus` writes `authors/<id>.yaml` (`phdude.author-profile` v1). `learn`
  computes descriptive statistics from approved samples — sentence-length mean and SD, opening
  diversity, paragraph density, transition rate, first-person rate, hedge rate, frequent
  terminology — as plain numbers and word lists a researcher can read and correct. Never an
  embedding. `consensus` merges the profiles (median, union of `preserve`, intersection of
  `avoid`) into `authors/project-consensus.yaml` and proposes a Decision when the merge changed.
- **Human approval on sections.** `phdude manuscript approve <s> --decision DEC-id` requires a
  decision that is approved and lists `manuscript:<section>` in `affects`; anything less exits 3.
  An approved section is not overwritten — a later submit is refused until `manuscript reopen`,
  which records the withdrawal.
- **Text statistics and the prose lint core.** `src/domain/textstats.js` and
  `src/domain/prose-lint.js` are the single implementation of every rule; the `academic-prose`
  skill's `scripts/prose-lint.mjs` shells out to `phdude prose --file`, so the skill and the gate
  can never disagree. Language tables for `en` and `es`; an unknown language runs the structural
  rules only and says so as an `info` observation.
- **Two new skills**, `academic-prose` (the drafting and revision contract, with references on
  AI writing patterns, epistemic language, academic style, voice matching and worked examples,
  plus YAML fixture tests) and `write` (the drafting loop). `academic-prose` is the one skill in
  the repository that declares a write, `manuscript/**`, and even that goes through
  `phdude manuscript submit`.
- **Three schemas** — `manuscript.json`, `author-profile.json`, `section-report.json` — and one
  venue profile schema behind `packs/venues/generic-thesis/profile.yaml`.
- **Slash commands** `/phdude-manuscript`, `/phdude-write`, `/phdude-deslop`, `/phdude-prose` and
  `/phdude-authors`.

### Changed

- `phdude next` gains three rules: `sections-planned` (medium — a section is planned and its
  claims are supported or canonical), `draft-blocked` (high — the last submit had blocks) and
  `approval-pending` (medium — a revised section with no decision behind it).
- `phdude gaps` gains `claim-unwritten` (low — a canonical claim no section references).
- `schemas/decision.json` accepts `manuscript:<section-id>` as an `affects` entry alongside an
  object id. Decisions only; a section is not an entity, so it is checked against the
  manuscript's own section list rather than the id registry.
- `loadSnapshot` reads the manuscript, its section bodies and its reports, so `status`, `next`,
  `gaps` and `matrix` all reason about the same manuscript.
- The example workspace gains an author profile learned from one approved sample, a manuscript
  whose voice is that profile, and an introduction that went through the whole loop: submitted as
  a draft, revised once with its filler removed, reported on by `phdude prose`, and approved by a
  decision. `write-context.md` and `prose-introduction.txt` join the golden files.
- `phdude init` creates `manuscript/reports/`.

### Fixed

- **A decision affecting a manuscript section was reported as a dangling reference.**
  `manuscript:<section>` is a valid `affects` entry, but the lineage graph treated it as a
  missing entity, so every command that reads a snapshot printed
  `DEC-… references missing manuscript:introduction` as a warning. A section is not a node in
  that graph, and its absence from it is not a dangling reference.

### Notes

- **No AI-detector score, on any command.** The guard runs before command parsing and matches
  option names only: `--detector`, `--humanize-to` and `--ai-detection-score` exit 3 everywhere,
  including on commands that do not exist, while `--file notes-on-detection.md` and
  `phdude packs detect` keep working.
- Author Voice reports `n/a` until a voice profile is active for the section being scored, and
  the aggregate renormalizes over the sub-scores that could be computed. A sub-score with no
  input is `null`, never `0`.
- The workspace version is unchanged at 2. `manuscript/` and `authors/` have existed since v0.1
  and everything added is additive, so no migration is needed.
- Still no runtime dependency beyond `yaml`, `ajv` and `fflate`, and still nothing in the writing
  pipeline that reaches the network.

## [0.3.0] — 2026-09-07

The Research Engine. PhDude can go and find current literature for each research question, and
it does so under a policy the researcher owns. **The network is off until you turn it on**,
**nothing from your documents leaves the machine**, and **every provider call is recorded as an
event** carrying the provider, the query and a result count — never a result payload.

### Added

- **Literature search.** `phdude research "<query>" [--question RQ-n] [--provider a,b]
  [--from YYYY] [--limit N] [--allow-network]` queries the providers the workspace configured
  and records what came back. Nothing reaches a provider unless `.phdude/research-policy.yaml`
  sets `network.enabled: true` or the call carries `--allow-network`; otherwise it exits 3 with
  `network access is disabled`. A provider that fails is a warning and the run continues on
  what the others returned; only a run where every provider failed exits 4. See
  [ADR 7](docs/adr/0007-network-policy-and-search-providers.md).
- **Five search providers** behind one port (`src/ports/search-provider.js`): OpenAlex,
  Crossref, arXiv, Semantic Scholar and PubMed. Each maps its own response into one normalized
  candidate shape, treats the response as untrusted, and goes through a shared HTTP policy — a
  15 s timeout, exactly one retry on 429/503 with a backoff capped at 2 s, a `phdude/<version>`
  User-Agent, and typed errors naming the provider. `fetch` is injected, never imported, so no
  test can reach the network. `searchProviderContract` runs the same eight checks against any
  implementation, yours included.
- **Candidates.** `CAND-*` records in `knowledge/candidates/`, one per *work* rather than per
  provider hit: two providers returning the same paper — same DOI, or same normalized title and
  year — produce one candidate, with the extra providers in `providers[]`, their ids under
  `ext.ids`, and a field the first provider left empty filled by one that reported it. A
  candidate found again by a later run is reported as existing, never rewritten: the verdict a
  researcher gave it is not something a re-run may reset.
- **Recorded searches.** `SEARCH-*` records in `research/searches/` carry the query, the
  question, the providers, the filters that were applied and one entry per run, so a re-run can
  repeat a search exactly as it ran rather than as the policy reads today.
- **Candidate review.** `phdude research list|show` to read the queue, `phdude research accept
  CAND-… [--type t] [--approve-preprint]` to turn one into a `SRC-` with its identifiers,
  provenance and a note of where it came from, and `phdude research dismiss CAND-… --reason "…"`
  to record why one is not going in. A preprint needs `--approve-preprint` under
  `research.preprints.require_approval`. Accept invents nothing: a field no provider reported
  stays empty and `cite check` reports it afterwards.
- **Freshness.** `phdude freshness` reports the last search behind every research question, how
  many days ago it ran and whether the policy calls that stale, plus the age of every source and
  a summary. `phdude research-fresh [--question RQ-n] [--all]` re-runs the stale searches and
  reports **only new candidates** — a re-run that finds the same literature again is the answer
  "nothing has changed". Read-only `freshness` never touches the network.
- **`phdude edit <id> --json '<fields>'`** — the v0.2 backlog item. It corrects the non-identity
  fields of a non-canonical object in place and writes one `edit` event naming what changed. It
  refuses a `canonical` object (propose a Decision), an identity field (the id is derived from
  it, so record the correction with `phdude add`), and a field the schema does not know. `state`
  is not editable: that is `phdude promote`.
- **A new `research` skill**, the first with `permissions.network: allowed` and therefore the
  first installed only when the policy sets `skills.allow_network: true`. It covers writing a
  query from a research question, reading candidates with the researcher, and never accepting
  one whose abstract nobody read.
- **Slash commands** `/phdude-research`, `/phdude-research-fresh`, `/phdude-freshness` and
  `/phdude-edit`.

### Changed

- `phdude next` ranks thirteen rules rather than eleven: `stale-search` (medium — a question
  never searched, or whose newest search has aged past `research.freshness.stale_after_days`)
  and `candidates-pending` (medium, at five or more unreviewed candidates).
- `phdude gaps` reports two more kinds: `question-never-searched` and `stale-search` (low). Both
  read the network policy — with the network closed the command they print opens the policy
  first, and `question-never-searched` drops from medium to low, since a workspace that closed
  the network has decided where its literature comes from rather than overlooked it.
- `phdude status` gains a Literature block: candidates by state, searches recorded, and how many
  questions have a stale or missing search. Candidates and searches are counted there rather
  than in the knowledge counts — a candidate is not knowledge until it is accepted.
- `schemas/source.json` accepts `provenance`, which an accepted source carries.
- The example workspace records a search a year old and two candidates, one of them accepted, so
  the freshness and staleness rules have something honest to report; a `freshness` golden joins
  the five that were already there, and every calendar-reading golden runs against a fixed
  present.
- `phdude doctor` prints the network policy and the configured providers. It never calls out.

### Fixed

- **`phdude research-fresh` failed the whole run over one unrunnable search.** A stored search
  whose question is no longer on disk threw, discarding the results of every re-run already done
  in the same invocation. That record is now a warning (`skipped SEARCH-…: …`) and the rest
  still run.
- **A result's `from` could never be corrected.** It was refused as an identity field, but a
  result's id is derived from its `summary` alone. It is editable now.

### Notes

- Requires Node 22 or newer. `pdftotext` (poppler-utils) is still optional.
- A provider call carries the query, the `limit` and `from` filters, a `phdude/<version>`
  User-Agent, and nothing from the workspace's documents — no file, no excerpt, no filename.
- Two providers take an API key, both read from the environment and never from the workspace:
  Semantic Scholar takes `PHDUDE_S2_API_KEY` as an `x-api-key` header, and PubMed takes
  `PHDUDE_NCBI_API_KEY` as the `api_key` query parameter NCBI documents. Neither key reaches an
  error message or the event log; both providers answer at the anonymous rate limit without one.
- OpenAlex and Crossref receive the `email` from `.phdude/author-profile.yaml` as a polite
  `mailto` when the profile has one, and nothing when it does not.
- The workspace version is unchanged at 2: `knowledge/candidates/` and `research/searches/` are
  new directories, created lazily on the first write, so no migration is needed.

## [0.2.0] — 2026-09-07

The Research Brain. The workspace starts reasoning about the literature it holds. Still no
model anywhere in the runtime, and still no network call.

### Added

- **Citation registry.** `phdude cite list|check|export` derives a stable `bibkey` per source
  (or honours one the source declares), verifies the registry against six finding kinds, and
  exports BibTeX or CSL-JSON. It is derived, never canonical: the export records no event, and
  the citation is always the `SRC-` id. `uncited-source` is informational and never fails the
  check on its own.
- **Literature matrix.** `phdude matrix [--format md|csv] [--question RQ-n]` prints one row per
  source: the research questions and claims its evidence reaches, the strongest evidence citing
  it directly, the facts drawn from its artifacts, and any pack-declared method tags.
- **Research gaps.** `phdude gaps` reports ten kinds of gap grouped by severity, each with the
  reason it fired and a runnable command. The uncited-source condition carries the one name
  `uncited-source` in both `gaps` and `cite check`. `phdude next` gained a matching rule that recommends
  the report once one high-severity gap or three gaps of any severity exist, and its closing
  line reports the open gap count rather than claiming the workspace is consistent.
- **Claim contradictions.** `phdude link CLAIM-a --contradicts CLAIM-b` records that two claims
  cannot both be true. The relation is symmetric and moves both sides to `disputed` with no
  decision required — a `canonical` claim included, because surfacing a contradiction should not
  wait for approval. Resolving one needs an approved decision naming a `survivor`, with every
  losing claim rejected first. `phdude status` lists open disputed pairs. The two writes are not
  atomic, so a repeat of the same call heals an asymmetric pair rather than reporting a no-op.
- **Methods.** `phdude add method` records design, paradigm, sampling, instruments, analysis and
  limitations as a first-class object, and `phdude link METH-… --to RQ-n` attaches it to the
  questions it addresses.
- **Provenance.** Claims and evidence carry `provenance.method` (`manual`, `agent-extraction`
  or `imported`) and `provenance.derived_from`, the artifacts behind the record. `phdude
  knowledge trace` prints both.
- **Workspace versioning and migrations.** `phdude.yaml` carries `workspace_version`, and
  `phdude migrate [--dry-run] [--force]` upgrades an older workspace through migration modules
  shipped in `migrations/`. Migration `0001-workspace-v2.mjs` backfills `provenance` on claims
  and evidence and `contradicts` on claims, and stamps the workspace at version 2. Steps are
  idempotent, run through the `Store` port only, and append one `migrate` event each. See
  [ADR 6](docs/adr/0006-workspace-versioning-and-migrations.md).
- **Skill contracts.** Every `SKILL.md` declares a `phdude:` block — `reads`, `writes` and
  `permissions` — validated against `schemas/skill.json` on load. A skill with no block loads
  with a least-privilege default and a warning. A skill requesting network access is refused
  unless `.phdude/research-policy.yaml` sets `skills.allow_network: true`; `phdude doctor` lists
  every discoverable skill with its source and permissions.
- **A seventh core skill, `literature`**, covering the citation check, the matrix and the gap
  report.
- **Slash commands for every CLI command**, `init`, `promote`, `cite`, `matrix`, `gaps`,
  `migrate` and `help` included; `CLAUDE.md`'s list is now generated from the installed
  templates.

### Changed

- Reads on an out-of-date workspace keep working and warn `workspace needs migration (1 → 2)`;
  writes (`add`, `link`, `ingest`, `decide`, `promote`, `packs detect`, `packs apply`, `mode`)
  exit 1 with that message and the hint `run phdude migrate`.
- Sources accept `bibkey`, `abstract`, `keywords` and `identifiers { doi, isbn, arxiv, pmid,
  url }`; the top-level `doi` and `url` still work, with `identifiers.doi` taking precedence.
- `phdude doctor` reports the workspace version and whether it needs migrating, and lists every
  discoverable skill with its source and permissions. Being the command you run when something
  is already wrong, it degrades rather than fails: one unloadable skill costs one warning and
  the rest are still listed, and a skill whose network permission the policy has not allowed is
  warned about rather than refused. Because `init` copies the core skills into
  `.phdude/skills/`, a copy identical to the shipped file reports as `core` and only an edited
  one as `workspace`.
- `phdude status` and `phdude next` account for disputed pairs and provenance, and `next` ranks
  eleven rules rather than ten.
- The example workspace now exercises every gap kind — a contradiction left disputed, an
  untested hypothesis, a question whose only claim is a candidate, and a classified but unmined
  artifact — and the golden tests assert the full set.

### Fixed

- **An unrecognised flag was ignored.** `phdude knowledge list --stat candidate` returned the
  unfiltered list, which reads as an answer rather than a mistake. Every command now declares
  the options it takes, and anything else exits 1 naming the flag and listing what that command
  accepts.
- **`phdude ingest .` walked the whole workspace.** It now walks `sources/` only, and an
  explicit path into `knowledge/`, `research/`, `decisions/`, `.phdude/` and the rest exits 1
  with `not a source path` — re-importing the knowledge base as evidence for itself is not a
  thing anyone wants.
- **`phdude decide supersede` took the superseding decision in `--by`,** the same flag that
  records which researcher made the call. The replacing decision moved to `--with`, `--by` is
  the researcher on every subcommand, and the old form exits 1 with that correction.

### Notes

- **No id churn.** The id material for every object type is unchanged from 0.1.0, the evidence
  (`source`, `locator`, `excerpt`) and decision (`title`, `rationale`, sorted `affects`, stable
  `change`) materials that 0.1.0's own fix wave settled included. A 0.1.0 workspace keeps every
  id it has; `phdude migrate` adds fields, and renames nothing.
- Requires Node 22 or newer. `pdftotext` (poppler-utils) is still optional.

## [0.1.0] — 2026-09-07

First release: the deterministic harness. No model is involved in anything below.

### Added

- **The workspace.** `phdude init` creates a plain git repository of YAML and Markdown —
  project config, seven policy files, the knowledge and research directories, decisions, and
  the append-only event log — and is safe to re-run.
- **Ingestion.** `phdude ingest` walks `sources/`, hashes every file, detects its kind,
  extracts text, sections and tables into a disposable cache, and records one artifact per
  distinct file hash. Parsers for PDF (via `pdftotext`), DOCX, PPTX, XLSX, CSV, Markdown and
  plain text; extraction degrades to a warning rather than failing.
- **The knowledge graph.** Artifacts, sources, claims, evidence, facts, results, research
  questions, hypotheses and decisions, one schema-validated file each, with content-derived
  ids so re-running an extraction duplicates nothing.
- **Conflict detection.** Facts that share a key but disagree across artifacts are reported
  by `phdude status`, and stay open until an approved decision covers every fact in the group.
- **Human authority.** `phdude decide propose|approve|reject|supersede` and
  `phdude promote <id> --decision <DEC-id>`: an object reaches `canonical` only through an
  approved decision that names it, and approvals are recorded against a named researcher.
- **Next-action scoring.** `phdude next` ranks ten rules by impact, then by how many objects
  depend on the action, and always prints the reasoning and the exact command to run.
- **Querying.** `phdude knowledge list|show|trace` filters the graph and walks lineage in
  both directions.
- **Editing what exists.** `phdude link <id> --to <id>…` attaches evidence and questions to a
  claim, questions to a hypothesis and artifacts to a source.
- **Packs.** Field and method packs (`business`, `computer-science`, `humanities`,
  `medicine`, `qualitative`, `quantitative`, `systematic-review`) with keyword detection that
  recommends but never applies itself. Workspaces may add their own.
- **Agent adapters.** Claude Code (skills, `AGENTS.md`, `CLAUDE.md` and twelve slash commands)
  and Codex (inline `AGENTS.md`), both refusing to overwrite a file you have taken ownership
  of.
- **Six agent skills** — core discipline, bootstrap, knowledge, decisions, next and review
  modes — installed into the workspace and refreshed by `init`.
- **`phdude bootstrap`** for a messy existing project, and `phdude doctor` for adapters,
  cache, schema versions and git state.
- **Typed errors** carrying a code, a message and an actionable hint, with exit codes 0 ok,
  1 usage, 2 validation, 3 policy, 4 external tool missing, honoured under `--json` too.

### Notes

- Requires Node 22 or newer. `pdftotext` (poppler-utils) is optional.
- No network access and no shell interpolation anywhere in the runtime.

[Unreleased]: https://github.com/LucioY250/phdude/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/LucioY250/phdude/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/LucioY250/phdude/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/LucioY250/phdude/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/LucioY250/phdude/releases/tag/v0.1.0

# Changelog

All notable changes to PhDude are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and PhDude adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  reason it fired and a runnable command. `phdude next` gained a matching rule that recommends
  the report once three or more gaps exist and nothing higher-impact has fired.
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

[Unreleased]: https://github.com/LucioY250/phdude/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/LucioY250/phdude/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/LucioY250/phdude/releases/tag/v0.1.0

# Changelog

All notable changes to PhDude are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and PhDude adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- **Next-action scoring.** `phdude next` ranks nine rules by impact, then by how many objects
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

[Unreleased]: https://github.com/LucioY250/phdude/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/LucioY250/phdude/releases/tag/v0.1.0

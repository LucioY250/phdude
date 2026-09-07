# 5. Field, method and venue knowledge lives in packs, never in the core

**Status:** Accepted (2026-09-07) — v0.1

## Context

PhDude must serve a medical trial, a literary study and an empirical software-engineering
paper without assuming any of them (PRD §3.5, §3.6, §7). The moment the core knows what a
"p-value" or an "IRB approval" is, it has picked a discipline and every other field becomes
a special case. Yet a quantitative thesis needs different checks than an ethnography.

## Decision

Domain knowledge ships as packs: a directory with `pack.yaml` (`phdude.pack v1`) and skills.

- **Two kinds in v0.1:** `field` (computer-science, business, medicine, humanities) and
  `method` (quantitative, qualitative, systematic-review); `venue` is reserved for v0.6.
- **A pack carries vocabulary, not logic:** `terminology`, `detect.keywords`, `reviewers`,
  `recommended_checks`, `skills`, optional `schemas`. No executable code.
- **Core schemas stay field-agnostic;** a pack may add fields only under `ext.<pack>`.
- **Detection recommends; it never applies.** `packs detect` scores keyword hits over cached
  text; only `packs apply <name>` edits `phdude.yaml`, writing an event.
- **Discovery reads the built-in `packs/` directory, then `.phdude/packs/`** in the
  workspace, later roots overriding earlier ones by name. Skill paths are confined to the
  pack directory, symlinks included.

## Alternatives considered

- **Field-specific forks of the core.** Multiplies maintenance and makes interdisciplinary
  projects unrepresentable.
- **A plugin system with executable hooks.** Rejected for v0.1: running third-party code
  against a private research workspace needs the permission model of PRD §76 (v0.7).
  Declarative packs get most of the value with none of that risk.

## Consequences

- Supporting a new discipline is a new directory, not a code change; a contract test
  validates every shipped pack.
- In v0.1 a pack changes only vocabulary and recommendations; anything more waits for the
  permission model.

# 4. The agent writes to the workspace only through the CLI

**Status:** Accepted (2026-09-07) — v0.1

## Context

PhDude splits the work: the deterministic runtime owns memory, validation and provenance;
the AI agent owns judgment (PRD §41a). But the agent has a file-writing tool and could edit
`knowledge/claims/CLAIM-x.yaml` directly. If it did, nothing would validate the object,
compute its id, stamp its actor, or append an event, and the researcher would lose the
guarantee that every canonical statement is traceable (PRD §3.4, §34, §82).

## Decision

Every mutating path goes through a `phdude` command, and the skills say so in as many words.

- **Writes are commands:** `add`, `decide`, `promote`, `packs apply`, `mode`, plus `init` and
  `ingest` for setup. Everything else reads.
- **Each mutating command validates against JSON Schema, derives the id, stamps
  `actor {researcher, agent}` and appends exactly one line to `.phdude/events.jsonl`.**
- **Agent-created objects enter as `candidate`.** Reaching `canonical` requires an approved
  Decision that lists the object in `affects`; `promote` refuses otherwise and exits 3.
- **The CLI contract is the integration surface:** `--json` on every command, typed errors
  with a `Suggested action:` line, and exit codes 0/1/2/3/4.
- Host files (`CLAUDE.md`, `AGENTS.md`, `.claude/commands/*`) are thin wrappers over these
  commands, so a new agent host needs no new write path.

## Alternatives considered

- **Let the agent write YAML and validate afterwards.** Errors surface far from their cause,
  ids drift, and the event log is incomplete by construction.
- **An MCP server instead of a CLI.** Reasonable later, but it would be a second write path
  to keep in sync, and it is not portable across every host PhDude targets.

## Consequences

- A misbehaving or hallucinating agent cannot silently corrupt the knowledge base; the worst
  it can do is add a `candidate` that a human reviews.
- CLI output shape and exit codes are versioned behaviour, not incidental formatting.
- Every write is attributable and replayable from `.phdude/events.jsonl`, independent of git.

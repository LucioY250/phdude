# 1. PhDude is a Node ESM CLI harness, not a service or a model

**Status:** Accepted (2026-09-07) — v0.1

## Context

PhDude has to run beside an AI coding agent, on the researcher's machine, inside the
researcher's own repository. Research workspaces live for years and hold unpublished work,
so the runtime must be inspectable, local-first and boring (PRD §3.7, §3.12).

The agents PhDude targets (Claude Code, Codex) already run in a terminal and can shell out.
That makes a CLI the smallest possible integration surface: no daemon, no port, no account.

## Decision

Ship PhDude as a single Node ESM package with a `phdude` binary, targeting Node >= 22.

- **Runtime dependencies stay minimal:** `yaml`, `ajv`, `fflate`. Argument parsing uses
  `node:util.parseArgs`; tests use `node:test`; hashing uses `node:crypto`.
- **Optional external tools degrade, never block.** `pdftotext` is probed at runtime; without
  it a PDF is still inventoried and hashed, and `phdude doctor` says what is missing.
- **No network calls in v0.1.** Every command reads and writes the local workspace only.

## Alternatives considered

- **A long-running service with an HTTP/MCP API.** Rejected for v0.1: it adds installation,
  lifecycle and auth problems, and every agent host can already run a command.
- **Python.** Strong scientific ecosystem, but the target agents ship in Node-shaped
  environments and Python packaging would dominate the install story. Analysis execution
  (v0.5) can still shell out to Python without the core depending on it.
- **A bundled binary.** Premature: it hurts auditability, which matters more than startup time.

## Consequences

- Installation is `npm i -g phdude` or `npx phdude`, and the source is readable in the
  installed package.
- The CLI is the public contract: exit codes, `--json` output and error shapes are versioned
  behaviour (see [ADR 4](0004-agent-writes-through-cli.md)).
- Anything needing a long-lived process (watchers, servers, provider adapters) is out of the
  core and must arrive as an adapter behind a port.

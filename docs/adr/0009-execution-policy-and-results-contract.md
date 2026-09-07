# 0009 — Execution policy and the results contract

**Status:** accepted
**Date:** 2026-09-07

## Context

An analysis is a script the researcher wrote, and PhDude has to run it to record what it found.
That is the first time the harness executes something it did not ship, on a machine that holds
unpublished research — the same class of decision as leaving the machine for literature (ADR 7),
and it gets the same answer: closed unless the workspace says otherwise.

Two further things had to be settled at the same time. A script's *result* has to become a
research object with lineage, or running it buys nothing that a terminal does not; and a run that
fails, hangs or asks for an interpreter nobody installed has to be reportable rather than a stack
trace.

## Decision

**One switch, closed by default.** `.phdude/research-policy.yaml` gains an `execution` block —
`enabled: false`, a `runtimes` map, and `timeout_seconds: 600`. A run is allowed by
`execution.enabled: true` or by `--allow-exec` on the command, and by nothing else;
`src/domain/policy.js` decides, as a pure function, and refuses with
`PhdudeError('POLICY', 'script execution is disabled', …)` naming both ways in. The network
switch does not open execution and execution does not open the network: a script gets neither
unless each was granted on its own.

**`execution.runtimes` is the registry, not a convenience.** `runtimeCommand(policy, runtime)`
maps a runtime name to the executable to spawn, defaulting to `node`, `python3` and `Rscript`. A
runtime the map does not name is a `VALIDATION` error listing the ones it does, so a typo in an
analysis is refused instead of spawning something nobody declared. A workspace that needs a
pinned interpreter names it there (`python3: /opt/venv/bin/python`) rather than relying on PATH.

**Scripts run behind a port.** `src/ports/analysis-runner.js` defines
`run({ runtime, script, args, cwd, env, timeoutMs }) → { exitCode, timedOut, signal, stdout,
stderr, durationMs }` and ships the contract suite every implementation must pass. `localRunner`
(`src/adapters/execution/local.js`) is the only implementation: `spawn` with an argument
array and no shell, so nothing in a script path, an argument or a policy value is ever
interpreted as a command; `cwd` is the workspace root; and the environment is built, not
inherited — `PATH`, `HOME`, `LANG` plus the `PHDUDE_WORKSPACE` and `PHDUDE_ANALYSIS` the caller
passes. A token in the researcher's shell is not one `os.environ` away from a script the
workspace declared.

**A failed run is a result, not an exception.** Only a runtime that cannot be started throws
(`TOOL_MISSING`, with the install hint). A non-zero exit comes back as its exit code, and a
script that outruns `timeout_seconds` comes back as `{ exitCode: null, timedOut: true }` — the
application turns that into `TOOL_MISSING` with a hint to raise the timeout. Both are recorded on
the analysis; a run that failed is part of the record of what was tried.

**The timeout binds the process tree, not one pid.** A run is spawned into its own process group,
and `timeout_seconds` ends the group: SIGTERM, then SIGKILL two seconds later. A script that traps
the polite signal, and the compiled tool or interpreter it shelled out to, both die with it —
otherwise the one bound on an arbitrary-code surface would be whatever the script agreed to
honour. `exitCode: null` with `timedOut: false` is a run some other signal ended, named in
`signal`; it is a failure, never a run that succeeded quietly.

**The results contract.** A script reads its inputs from `data/`, is told which analysis it is
through `PHDUDE_ANALYSIS`, and writes `analysis/out/<name>/results.json`:

```json
{ "results": [{ "key": "…", "summary": "…", "values": { }, "unit": "…" }] }
```

PhDude turns each entry into a `RESULT` object with `from: <ANALYSIS-id>`, state `candidate`, and
`ext.analysis: { key, run_at }`. Re-running with identical values is a no-op per result. A key
that reappears with a **different summary** creates a new `RESULT` and marks the old one
`rejected` with a pointer to its replacement, because a superseded finding is part of the record
too. A key that reappears with **new values under the same summary** is the same record,
corrected in place: a result id is derived from its summary and its analysis, so that record
would have to supersede itself, and there is no id for it to point at. A script that wants the
old numbers kept puts the finding in the summary — `"Mean respondent age is 38.4 years"`, not
`"Mean age"`. Each run stores the input and output hashes it saw, which is what makes staleness a
computation rather than a guess.

**A v0.4 result keeps its v0.4 id.** `from` joins the id material only when it names an analysis.
v0.4 let `from` be prose — `"logistic regression on survey sample (n=312)"` — and every such
result's id came from its summary alone. Rewriting those ids would break every reference to them,
so migration 0002 does not, and `newResult` does not compute a different one: adding the same
v0.4 result again after the migration still finds the record already on disk.

**Skills ask for it explicitly.** The skill contract's `permissions` gains
`execution: none|allowed`, mirroring `network`, and the workspace grants it with
`skills.allow_execution`. `phdude init` withholds a skill the policy has not cleared and installs
the rest; `phdude packs apply` refuses the whole pack.

## Consequences

- CI needs no interpreter beyond Node: the contract suite spawns the Node binary running the
  tests, and the `python3` and `Rscript` cases skip with a message when those are absent.
- Every run costs one event and one entry in the analysis's `runs`, so `git log` and
  `.phdude/events.jsonl` show what ran, when, against which input hashes.
- Migration 0002 takes the workspace to version 3: it adds the policy keys when they are missing
  and creates `knowledge/datasets/`, `analysis/out/`, `tables/out/` and `figures/out/`. What those
  three `out/` directories hold is regenerable — a `results.json`, a rendered table, a figure
  image — so they are ignored the way `outputs/` is, and the migration appends the rules to a
  `.gitignore` the workspace already has rather than writing one it chose to delete. It writes
  the policy file through the YAML parser, so comments a researcher added to that one file do not
  survive the step — `phdude migrate` refuses a dirty tree precisely so the rewrite is one
  reviewable diff. A workspace with no policy file gets none written: every key it would add
  reads as closed when absent.
- The cost is that PhDude cannot see inside a script. It records what the script declared it
  found; whether the statistics behind it are sound is the researcher's judgement, supported by
  the analysis skill and the method packs, and PhDude never claims otherwise.

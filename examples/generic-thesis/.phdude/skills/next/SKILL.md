---
name: next
description: Ask the workspace for the highest-impact next action, present the top candidates with their reasoning, and let the researcher choose.
phdude:
  version: 1
  reads: [knowledge/**, research/**, decisions/**, .phdude/events.jsonl]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# Next

Follow `[[phdude-core]]`: recommending is your job, executing canonical changes is not.

## Run it

```
phdude next --json
```

Returns `{ actions, top }`, where `actions` is every candidate action ranked by impact, then by
how many objects depend on it, then by rule order (PRD S45).

Four rules are worth knowing by name.

- **`gaps`** fires when the workspace has at least one high-severity research gap or three or
  more gaps in total, and its command is `phdude gaps`. Seeing it at the top means the useful
  next move is to work the gap report — follow `[[literature]]` for how to read one.
- **`stale-search`** (medium) fires when a research question has no current literature behind
  it: never searched, or its newest search is older than `research.freshness.stale_after_days`.
  Its `why` says which questions and how old the oldest search is, and its command is a first
  `phdude research` or a `phdude research-fresh`, depending on which case the question is in.
  Both reach the network, so report it and ask rather than running it yourself
  (`[[phdude-core]]`).
- **`candidates-pending`** (medium) fires at five or more candidates still in state `candidate`.
  It is a queue, not an error: the researcher reviews and accepts them, never you. Follow
  `[[research]]`.
- **`consistent`** is always the last entry: it reads `Workspace is consistent` only when the
  gap report is empty, and `N open gap(s); run phdude gaps` otherwise, so never present a
  workspace as settled on the strength of that line alone.

## Present the top 3

Show `top` first, then the next two entries of `actions`, each with:

- the action itself;
- **why**, from the `why[]` list (never omit this — PRD S45 requires the reasoning, not just the
  action);
- **expected impact** (`high | medium | low`);
- the `command` PhDude suggests to address it.

Example shape:

```
Highest-impact next action:

Update literature supporting RQ2.

Why:
- current search is 7 months old
- 3 central claims depend on it
- recent contradictory evidence exists

Expected impact: HIGH
```

## Ask before acting

After presenting the top 3, ask the researcher which one to execute. Never run
`phdude decide approve`, `phdude promote`, or edit canonical objects on your own initiative just
because `next` suggested it — `next` recommends, it does not authorize (`[[decisions]]`,
`[[phdude-core]]`).

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

One rule is worth knowing by name. `gaps` fires only when the workspace has three or more
research gaps *and* no high-impact rule fired this run, and its command is `phdude gaps`. Seeing
it at the top means nothing urgent is outstanding and the useful next move is to work the gap
report — follow `[[literature]]` for how to read one. Seeing it absent while gaps exist means
something higher-impact already points at the same underlying problem; do that instead.

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

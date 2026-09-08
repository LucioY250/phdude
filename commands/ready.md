---
description: Say whether the work can be submitted, and list what is blocking it.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude ready $ARGUMENTS --json
```

Read-only: it composes the venue profile's blocking rules, Research Health against
`ready.min_health`, every requirement in `ready.require`, and the high-severity gaps. It writes
nothing and records no event. Exit 0 means ready, exit 2 means something blocks.

Report the verdict first, then every blocking item with the command that fixes it, in the order
the report gives them. Do not run those commands unprompted: several of them write, and which
one to run next is the researcher's call. `phdude review accept|dismiss|resolve` and
`phdude manuscript approve` in particular are never yours.

A `lite` workspace blocks only on the `block`-severity items and lists the rest under
`relaxed` - say that those findings still stand rather than reporting a clean gate.

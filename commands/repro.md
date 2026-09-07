---
description: Report which analyses, tables and figures are stale, unbuilt, or missing an output.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude repro $ARGUMENTS --json
```

(`check`, or nothing at all — the report is the same.)

Read every item that is not `up-to-date`. `stale` means an input moved since the run that
produced it, so the fix is `phdude analyze run <id>`, `phdude table build <id>` or
`phdude figure build <id> --allow-exec`; `never-run` means nothing has been produced yet;
`missing-output` means the record claims a file that is not on disk. Never edit an output by
hand to make this report quiet - rebuild it, or say why the input changed.

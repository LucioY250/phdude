---
description: Report adapter availability, cache state, schema versions, and git state.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude doctor $ARGUMENTS --json
```

Report any warnings plainly (e.g. a missing `pdftotext`) and suggest the fix. This command is
diagnostic only; it never changes the workspace.

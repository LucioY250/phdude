---
description: Recommend the single highest-impact next action, with reasoning.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude next $ARGUMENTS --json
```

Follow `.phdude/skills/next/SKILL.md`: present the top action plus the next two candidates, each
with its `why` and `impact`, then ask the researcher which one to execute. Never execute a
canonical change on your own initiative.

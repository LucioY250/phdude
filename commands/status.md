---
description: Show project info, inventory, knowledge counts by state, open conflicts, and pending decisions.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude status $ARGUMENTS --json
```

Report project info, inventory, and knowledge counts, describing each knowledge state per
`.phdude/skills/phdude-core/SKILL.md` (never present a `candidate` count as settled knowledge).
Call out open conflicts and pending decisions explicitly. If the researcher wants to act on
what you find, continue with `.phdude/skills/next/SKILL.md`.

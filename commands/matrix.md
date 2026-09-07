---
description: Print the literature matrix - one row per source, showing which questions and claims it reaches.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude matrix $ARGUMENTS --json
```

(`--format md|csv` (default `md`), `--question RQ-n` to filter to sources reaching one research
question.) Follow `.phdude/skills/literature/SKILL.md` to interpret the result. A row with an
empty Questions column means the source is recorded, and may even be cited, but its evidence is
not yet attached to any claim.

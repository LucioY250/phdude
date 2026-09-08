---
description: List the agent skills this workspace loads, or install and remove an external one.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude skills $ARGUMENTS --json
```

(`list`, `install <path|https url>`, or `remove <name>`.) `install` and `remove` change what the
workspace loads, so only run them when the researcher has named the skill. A skill from a git URL
needs `--allow-network`, and a skill whose declared permissions the research policy has not opened
is refused rather than installed. PhDude copies a skill's files and never runs them. Follow
`.phdude/skills/phdude-core/SKILL.md` for the general write-only-via-CLI rule.

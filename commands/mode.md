---
description: Set the review mode - lite, full, ruthless, or off.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude mode $ARGUMENTS --json
```

(one of `lite`, `full`, `ruthless`, `off`.) This persists to `phdude.yaml`. Follow
`.phdude/skills/review-modes/SKILL.md` for what each mode changes about your behavior, and only
change the mode when the researcher asks for it.

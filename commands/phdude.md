---
description: PhDude workspace dispatcher - status and next by default, or set the review mode.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

If `$ARGUMENTS` is empty, run:

```
phdude status --json
phdude next --json
```

and report the status summary followed by the top next-action recommendation, following
`.phdude/skills/next/SKILL.md` for how to present it (top 3, with why and impact) and
`.phdude/skills/phdude-core/SKILL.md` for how to describe knowledge states.

If `$ARGUMENTS` is exactly one of `lite`, `full`, `ruthless`, `off`, run:

```
phdude mode $ARGUMENTS --json
```

and confirm the new mode, following `.phdude/skills/review-modes/SKILL.md`.

Otherwise, treat `$ARGUMENTS` as a `phdude` subcommand: run `phdude $ARGUMENTS --json` directly
and follow the matching skill under `.phdude/skills/<name>/SKILL.md`.

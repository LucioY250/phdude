---
description: Create a research workspace here, or refresh an existing one.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude init $ARGUMENTS --json
```

(`[dir] [--title <text>] [--agents claude-code,codex] [--no-git]`.) It is safe to re-run:
missing files are added, the PhDude-managed ones are refreshed, and every path comes back as
`created`, `updated` or `skipped`. It never overwrites `phdude.yaml`, a policy file under
`.phdude/`, or an `AGENTS.md` or `CLAUDE.md` whose managed marker the researcher removed —
report what it skipped instead of trying to force it. Ask before choosing a title; the
directory name is the default.

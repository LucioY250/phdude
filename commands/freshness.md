---
description: Report how current the workspace's literature is - last search per question, age per source.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude freshness $ARGUMENTS --json
```

Read-only: it touches no network and writes nothing. Returns the last search and its age for
every research question, whether the policy calls that stale, the age in years of every
recorded source, and the counts that summarise both.

Follow `.phdude/skills/literature/SKILL.md` to report it: name the stale and never-searched
questions rather than the totals, and recommend `phdude research-fresh` (or a first
`phdude research` for a question nobody has searched) instead of running anything yourself.

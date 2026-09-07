---
description: Academic Prose Quality report for a text file - six located sub-scores and the observations behind them.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude prose $ARGUMENTS --json
```

`--file <path>` is required; add `--lang es` for Spanish. Follow
`.phdude/skills/academic-prose/SKILL.md` to interpret the result: fix the sentence each
observation names, never the paragraph around it, and never invent a detail to make prose sound
more specific - every concrete detail must resolve to something the workspace records.

Three sub-scores read `n/a (needs manuscript context)` for a bare file: they are computed
against the evidence graph and the author's voice profile, which only a manuscript section has.

PhDude has no AI-detector score and will not produce one. If asked for one, say so and offer
this report instead.

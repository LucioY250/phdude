---
description: Ingest the research workspace, classify artifacts, and extract sources, facts, and candidate claims.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude bootstrap $ARGUMENTS --json
```

Then follow `.phdude/skills/bootstrap/SKILL.md` step by step: classify every artifact with
`role: unknown`, then extract sources, facts (with locators), and candidate claims backed by
evidence. Finish with the required 10-line-or-fewer summary for the researcher.

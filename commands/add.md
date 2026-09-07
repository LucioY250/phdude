---
description: Add a candidate claim, evidence, fact, source, question, hypothesis, result, or artifact-role.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude add $ARGUMENTS --json
```

(`<claim|evidence|fact|source|question|hypothesis|result|artifact-role> --json '<obj>'`.)
Follow `.phdude/skills/phdude-core/SKILL.md`: everything you add starts as `candidate` and must
be traceable to real evidence, never fabricated. See `.phdude/skills/bootstrap/SKILL.md` for the
JSON shape of each type.

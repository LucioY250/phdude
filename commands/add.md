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
Follow `.phdude/skills/phdude-core/SKILL.md`: a new object starts as `candidate` and must be
traceable to real evidence, never fabricated. `artifact-role` is the one exception — it updates
an existing artifact's `role` field, not a new candidate object. See
`.phdude/skills/bootstrap/SKILL.md` for the JSON shape of each type.

---
description: Propose, approve, or reject a research Decision.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude decide $ARGUMENTS --json
```

(`propose --title --rationale --affects --change '<json>'`, `approve <DEC-id> --by <name>`, or
`reject <DEC-id> --by <name>`.) Follow `.phdude/skills/decisions/SKILL.md`: never approve or
reject a decision on the researcher's behalf unless they explicitly said so in this conversation,
and always record `--by` with their real name.

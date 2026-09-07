---
description: Propose, approve, reject, or supersede a research Decision.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude decide $ARGUMENTS --json
```

(`propose --title --rationale --affects --change '<json>'`, `approve <DEC-id> --by <name>`,
`reject <DEC-id> --by <name>`, or `supersede <DEC-id> --by <name> --with <DEC-id>`.) Follow
`.phdude/skills/decisions/SKILL.md`: never approve, reject or supersede a decision on the
researcher's behalf unless they explicitly said so in this conversation, and always record
`--by` with their real name — on `supersede` too, where `--with` carries the replacing
decision.

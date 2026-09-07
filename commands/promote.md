---
description: Move an object to canonical (or another state) with an approved Decision behind it.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude promote $ARGUMENTS --json
```

(`<id> --decision <DEC-id>`, or `<id> --to <state>`.) Promotion to `canonical` exits 3 unless
an `approved` Decision lists the object in `affects`. Follow
`.phdude/skills/decisions/SKILL.md`: never approve the Decision yourself to unblock this, and
never edit the YAML instead. Resolving a contradiction is the special case — the Decision must
name a `survivor`, and every losing claim must already be `rejected` before the survivor is
promoted.

---
description: Attach existing evidence, questions or artifacts to an existing object.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude link $ARGUMENTS --json
```

(`<id> --to <id> [<id>…]`.) Allowed relations: claim → evidence, claim → question,
hypothesis → question, source → artifact. This is the only way to attach evidence to a claim
that already exists, because `phdude add` derives ids from content and returns the original
record unchanged. Links are additive and idempotent. A `canonical` object cannot be linked —
follow `.phdude/skills/decisions/SKILL.md` and propose a Decision instead.

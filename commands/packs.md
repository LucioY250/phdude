---
description: List, detect, or apply field and method research packs.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude packs $ARGUMENTS --json
```

(`list`, `detect`, or `apply <name>`.) `apply` edits `phdude.yaml`, so only run it when the
researcher has agreed to the recommended pack. Follow `.phdude/skills/phdude-core/SKILL.md` for
the general write-only-via-CLI rule.

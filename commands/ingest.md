---
description: Discover, hash, and extract text from files under sources/ (or the given paths).
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude ingest $ARGUMENTS --json
```

This only inventories and caches artifacts; it does not classify or extract knowledge. Report
the artifacts found and their `extracted.status`. If any artifact now has `role: unknown`,
continue with `.phdude/skills/bootstrap/SKILL.md` to classify and extract from it.

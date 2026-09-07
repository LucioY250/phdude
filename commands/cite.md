---
description: List, verify, or export the citation registry (BibTeX/CSL-JSON).
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude cite $ARGUMENTS --json
```

(`list`, `check`, or `export [--format bibtex|csl-json]`.) Follow
`.phdude/skills/literature/SKILL.md` to interpret the result. Run `phdude cite check` before
any writing task and fix every non-`uncited-source` finding it reports before citing further —
`uncited-source` is informational and does not fail the check on its own.

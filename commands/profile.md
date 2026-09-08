---
description: "Venue profiles: what the venue expects, what the manuscript does not meet yet, and which venue it targets."
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude profile $ARGUMENTS --json
```

(`list`, `show [--profile <venue>]`, `check [--profile <venue>]`, or `use <venue>`.)

`check` reports what the venue asks for that the manuscript does not meet yet: a required
section that is missing, a section out of the venue's order, a section or abstract over its word
limit, a figure in a format the venue does not take. It exits 2 when a finding blocks. Report the
findings; do not edit `manuscript/` to make them go away, and do not raise a limit in a venue
profile to fit the prose. Cutting the section is the researcher's call.

`use <venue>` rewrites `manuscript.yaml`, so only run it when the researcher has said which venue
the work is going to. Follow `.phdude/skills/phdude-core/SKILL.md` for the general
write-only-via-CLI rule.

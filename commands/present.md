---
description: Write the presentation outline for the approved manuscript, or for the claims the evidence supports.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude present $ARGUMENTS --json
```

(`outline [--from manuscript|claims] [--profile <venue>] [--force]`.)

`--from manuscript` (the default) writes one slide per **approved** section, in manuscript order.
`--from claims` writes one slide per supported or canonical claim. Either way the bullets are the
claim's strongest evidence — up to three excerpts, strongest first — and nothing else: an outline
says what the research can support, so never add a bullet the evidence does not carry.

The outline lands in `outputs/<slug>/outline.md`, and in `outline.pptx` when pandoc is installed
and a PPTX template is registered for the profile. `outputs/` is derived: never edit a file there,
never read one back as knowledge, and never cite one. An outline whose Markdown already says
exactly this reports `up to date` and writes nothing; `--force` writes anyway.

A section that is still a draft does not reach the slides. If nothing is approved yet the command
says so — approve a section with `phdude manuscript approve`, or outline the claims instead.

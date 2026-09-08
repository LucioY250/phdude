---
description: Build the manuscript into Markdown, DOCX, PDF, LaTeX or HTML from its approved sections, with the bibliography regenerated from the citation registry.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude build $ARGUMENTS --json
```

(`[--format md|docx|pdf|latex|html] [--profile <venue>] [--sections a,b] [--include-drafts]
[--force]`.)

The default format is `md`, which needs nothing installed. Every other format goes through
Pandoc, and `pdf` through a TeX engine as well; when one of those is missing the command exits 4
naming what to install, and it never silently produces something else instead.

The default venue is `manuscript.yaml`'s `target_profile`, or `generic-thesis`. The venue decides
the section order, the section headings, the citation style and the LaTeX template.

Only approved sections are built. `--include-drafts` adds drafts and revisions and marks the
document a draft on its own front page; `--sections a,b` narrows the build, and a section named
there that is not approved is an error rather than a silent omission.

The deliverables land under `outputs/<slug>/`: the document, `references.bib`, and the figures
the prose shows. Never edit anything under `outputs/` — it is rebuilt from the manuscript, and the
next build overwrites it.

A build whose inputs have not moved reports `up to date`, renders nothing and records nothing.
Report what the build produced by naming the file and the venue; a `warnings` entry is a real
loss (a figure that could not be converted, a CSL the built-in renderer cannot apply) and has to
be passed on, not swallowed.

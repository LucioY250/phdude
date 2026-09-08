---
name: build
description: Build the manuscript into the file somebody asked for - DOCX, PDF, LaTeX, HTML or Markdown - read what the venue profile says is still missing, and never hand-edit what a build produced.
phdude:
  version: 1
  reads: [manuscript/**, knowledge/**, figures/out/**, tables/out/**, packs/venues/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# Build

Follow `[[phdude-core]]`. A build is derived: it turns approved prose into a deliverable, and it
is never where a correction goes.

## Run it

```
phdude build --json
phdude build --format docx --json
phdude build --format latex --profile ieee --json
```

The default format is `md` and the default venue is `manuscript.yaml`'s `target_profile`, or
`generic-thesis`. Returns `{ slug, format, profile, built, reason, changed, renderer, sections,
output: { path, hash }, bib, figures, warnings }`.

## What comes back

- **`built: false`, `reason: "up to date"`** — every input hashes to what the last build recorded
  and the output file is still the one that build wrote. Nothing rendered, nothing was recorded.
  This is the normal answer to "is the DOCX current?", and it is the answer to report. Do not
  reach for `--force` to make something happen; force it only when the researcher asks for a
  rebuild, or when a tool outside PhDude has touched the output.
- **`built: true`** — `changed` names what moved: a section file, a figure, `references.bib`, the
  venue profile, the template, or `renderer` when Pandoc itself was upgraded. Say which.
- **`warnings`** — a real loss every time. A figure that could not be converted to the format the
  venue takes, a CSL style the built-in Markdown renderer cannot apply, an asset the prose points
  at that is not on disk. Pass each one on; never report a build as clean over a warning.

## Exit 4 means a missing tool, not a failure

`md` is built in and always works. `docx`, `html` and `latex` need Pandoc; `pdf` needs Pandoc and
a TeX engine. When one is missing the command exits 4 and names the package to install. Report
that sentence to the researcher and stop — installing software is theirs to decide, and there is
no fallback that quietly produces a different format under the name of the one they asked for.
`phdude doctor` lists what this machine has.

## Before you build, read the venue

```
phdude profile check --json
```

`build` does not enforce the venue's rules: it renders what the manuscript is. `profile check` is
what says the abstract is over the limit, a required section is missing, or a figure is in a
format the venue does not take. Run it first, report the blocking findings, and let the
researcher decide whether to fix the prose or change the venue. A section over its limit is fixed
through `[[write]]` / `[[academic-prose]]`, never by raising the limit in the venue pack.

## Only approved prose

A build takes `approved` sections. `--include-drafts` adds drafts and revisions and marks the
document a draft in its own front matter, so a draft cannot be mistaken for the finished thing —
say so when you report such a build. `--sections a,b` narrows the build to some of them.

A manuscript with nothing approved exits 2. That is not a build problem: the answer is
`phdude manuscript approve <section>`, which is the researcher's act (`[[decisions]]`), not
yours.

## Never edit what a build wrote

Everything under `outputs/` is derived: it is rebuilt from the manuscript, the citation registry
and the venue profile, and the next build overwrites it. Fixing a typo in `outputs/…/manuscript.md`
loses the fix and leaves the workspace saying something different from the file. The prose is
corrected through `phdude deslop <section> --file`, the reference through `phdude edit` on the
source, the figure through `phdude figure build` — then build again.

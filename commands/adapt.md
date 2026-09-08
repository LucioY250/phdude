---
description: What moving the manuscript to another venue would take - the section mapping, the word-limit deltas, the figure formats and the terminology - and, with --apply, the adapted manuscript.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude adapt $ARGUMENTS --json
```

(`--to <venue>`, optionally `--apply`. `phdude profile list` names the venues.)

Read the plan before doing anything with it:

- **`mapping`** — one row per section. A row with `to: null` is one the venue has no place for:
  say so and ask the researcher what it becomes. A row with `from: null` is a section the venue
  requires that the manuscript does not have.
- **`limits`** and **`abstract`** — a positive `delta` is words that have to go. Cutting them is a
  `[[write]]` / `[[academic-prose]]` job through `phdude deslop`, never a smaller limit in the
  venue profile.
- **`figures`** — a figure whose format the venue does not take. `phdude build` converts SVG to
  PDF when `rsvg-convert` is installed; otherwise the figure needs another output.
- **`terminology`** and **`citation_style`** — what the venue calls things, and the reference
  style that takes over.

Without `--apply` nothing is written. With it, PhDude writes
`manuscript/manuscript.<venue>.yaml`: the same section files under the venue's ids, titles and
order, with anything over a limit marked `revised`. The canonical `manuscript/manuscript.yaml`
and every `.md` under `manuscript/` are left exactly as they were — **adapt never rewrites
prose.** Follow `[[venue-adapt]]` for the revision loop that does.

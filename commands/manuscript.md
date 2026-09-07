---
description: The manuscript: plan its sections, submit a draft through the writing gates, approve or reopen a section.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude manuscript $ARGUMENTS --json
```

(`init [--title "…"] [--language en] [--voice <author-id>|consensus]`, `list`, `show <section>`,
`status`, `submit <section> --file <draft.md> [--revision]`, `approve <section> --decision
<DEC-id>`, or `reopen <section>`.)

`submit` is the only way prose reaches `manuscript/`. Never write or edit a section file
directly: write your draft to a scratch file and submit that. The deterministic gates run over
the draft first, and any blocking finding means nothing is written at all — fix the draft and
submit it again rather than working around the gate.

Citations are written `[@<bibkey>]` or `[@SRC-…]` and must already resolve to a source in the
registry. A source you have not accepted yet is not a citation you may use: run
`phdude research accept` with the researcher first, or cite something else.

`approve` records the researcher's approval and needs an approved Decision that lists
`manuscript:<section>` in its `affects`. Propose that decision, let the researcher approve it
with `phdude decide approve … --by <their name>`, and only then approve the section. Never
approve a section on your own initiative, and never reopen an approved one without being asked:
approved manuscript text is the researcher's, not yours.

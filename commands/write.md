---
description: Assemble the bounded writing context for one manuscript section and print the draft contract.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude write $ARGUMENTS --json
```

(`<section> [--voice <author-id>] [--budget <chars>]`.)

The command writes `.phdude/cache/writing/<section>/context.md` and prints where it is, what
went into it, what did not fit in the budget, and the contract your draft has to meet. Read the
context file — it carries the section's claims with their states, the strongest evidence behind
each, the citation keys you may use, the writing policy and the verb table — and follow
`.phdude/skills/write/SKILL.md`.

`write` never writes prose and never touches `manuscript/`. Write the draft to a scratch file
and submit it with `phdude manuscript submit <section> --file <draft.md>`; the gates run there.

Anything the context does not carry, you do not have. If you need a number, a source or a
finding that is not in it, say so and stop — inventing one is the worst failure this pipeline
can produce.

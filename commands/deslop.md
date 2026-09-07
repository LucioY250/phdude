---
description: The revision contract for a manuscript section, or a revision run through every writing gate.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude deslop $ARGUMENTS --json
```

(`<section>` for the contract, `<section> --file <revised.md> [--allow-additions]` to submit the
revision.)

Without `--file` it reports what the section's prose is doing now — the six sub-scores and every
located observation — plus what a revision may change and what it must preserve exactly.

Revise the sentences the observations name, one at a time, into a scratch file, then pass that
file back. The meaning gate compares it against the section as it stands and blocks a revision
that drops a claim marker, a citation, a number or a negation: "may reduce" and "reduces" are
different claims, and losing a hedge is losing a claim. A clean revision is recorded as
`revised`; a blocked one writes nothing.

`--allow-additions` is the researcher's opt-in for a revision that genuinely adds a claim or a
citation. Do not pass it to get around a block.

PhDude has no AI-detector score and will not produce one. Deslopping means clearer, more
specific, better-evidenced prose — never evasion.

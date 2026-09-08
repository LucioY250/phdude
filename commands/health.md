---
description: Score the project's Research Health across eight explainable dimensions.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude health $ARGUMENTS --json
```

Read-only unless the researcher asked for `--save`: it touches no network, and the score is
recomputed from the workspace every time. Returns eight dimensions - literature coverage,
evidence strength, methodological integrity, citation quality, freshness, reproducibility,
consistency and academic prose quality - each with its score out of 100, its weight, and the
observations the score was derived from. A dimension the workspace cannot answer for scores
`null` rather than a number nobody measured.

Report the weakest scored dimensions and quote the observations behind them, with the ids they
name. The commands that move each dimension are `phdude research-fresh`, `phdude link`,
`phdude add method`, `phdude cite check`, `phdude repro check`, `phdude decide propose` and
`phdude prose <section>`; recommend one, and let the researcher run it.

PhDude has no AI-detector, "humanity" or AI score, and never will (PRD §30c). A flag asking for
one is refused with exit 3. Do not present the overall as a publication verdict either - it is
the workspace scoring itself against what it recorded.

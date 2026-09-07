---
description: Declare an analysis script, run it under the workspace execution policy, and record its findings as RESULT objects.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude analyze $ARGUMENTS --json
```

(`add --json '{"name":"…","runtime":"node","script":"analysis/…","inputs":["DATASET-…"]}'`, or
`list`, `show <ANALYSIS-id>`, `run <ANALYSIS-id> [--allow-exec] [--force]`, `runs <ANALYSIS-id>`.)

Never run the script yourself — not with Bash, not with a notebook. `phdude analyze run` is the
only thing allowed to execute it, and it is the only thing that records what came back. A run
refuses unless `execution.enabled` is set or `--allow-exec` is passed; say so plainly rather
than reaching for another way to run the code.

The script's side of the contract: it reads its inputs from `data/`, it gets `PHDUDE_WORKSPACE`
and `PHDUDE_ANALYSIS` in its environment, and it writes
`{"results":[{"key":"…","summary":"…","values":{…},"unit":"…"}]}` to the path the analysis
declares. Each entry becomes a `RESULT-` object.

A run whose inputs have not changed since the last successful one is refused as up to date. That
is information, not an obstacle: re-running it would produce the same numbers. Pass `--force`
only when the researcher asks for it. A run whose input file no longer matches its `DATASET`
record is refused too, and `--force` does not get past that one: register the file again, point
the analysis at the new id, then run. `phdude next` prints the sequence.

`add` takes `--json '<declaration>'` or `--file <path>.json`; the two are the same declaration.

Report the findings as the analysis stated them, with their units. Do not restate a number as a
conclusion, and do not call anything significant that the script did not.

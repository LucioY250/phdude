---
description: Declare a figure with alt text, build it by running its generator, and report which figures have gone stale.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude figure $ARGUMENTS --json
```

(`add --json '<declaration>'`, or `list`, `show <FIG-id>`, `build <FIG-id>`, `check`.)

A declaration is `{"name":"…","caption":"…","alt":"…","generator":{"runtime":"node","script":"phdude:bar-chart","args":[…]},"inputs":["RESULT-…"],"outputs":[{"path":"figures/out/….svg","format":"svg"}]}`.

`alt` is required and must say what the figure *shows* — the finding, in one sentence a reader
who cannot see it can use. "Bar chart of weight" is not alt text; "group b averages 4 kg more
than group a" is. Write it before running anything.

`script` is `phdude:bar-chart` (the generator PhDude ships) or a script the workspace holds under
`figures/`. Nothing else runs, and nothing runs at all unless the policy sets
`execution.enabled: true` or the researcher passes `--allow-exec`. Never run a generator yourself
— `phdude figure build` is what records the run.

`check` reports missing alt text, outputs that are not on disk, and inputs that have changed
since the build that used them. Read it before citing a figure in the manuscript.

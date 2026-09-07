---
description: Declare a table over a result or a dataset, then render it as Markdown, LaTeX and CSV under tables/out/.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude table $ARGUMENTS --json
```

(`add --json '<declaration>'`, or `list`, `show <TABLE-id>`, `build <TABLE-id>
[--format md,latex,csv] [--force]`.)

A declaration is `{"name":"mean-weight","caption":"…","source":{…},"columns":[…],"formats":[…]}`.
`source` is `{"result":"RESULT-…"}` or `{"dataset":"DATASET-…","columns":["…"],"limit":20}` —
exactly one of the two. `columns` on the table itself is `[{"key":"…","label":"…","format":"number:2"}]`;
leave it out and every key the source has becomes a column. `formats` defaults to all three.

The name is the identity: declaring the same name again corrects the declaration in place and
keeps the build history. Never edit a file under `tables/out/` — it is generated, and the next
build overwrites it.

`build` renders and records the hash of what it read and what it wrote. `--format` narrows it to
some of the formats the table declares; one it does not declare is an error. A build whose source
has not moved reports `up to date` and writes nothing; `--force` rebuilds anyway. Report the table by
what it says, not by the fact that it rendered, and cite the RESULT rather than the file.

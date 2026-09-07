---
description: Register a file under data/ as a dataset, hashed and profiled; list, show or profile the registered ones.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude data $ARGUMENTS --json
```

(`add <path under data/> [--json '{"description":"…","license":"…","sensitive":true}']`, or
`list`, `show <DATASET-id>`, `profile <DATASET-id>`.)

The file's bytes are the dataset's identity, so registering the same file twice changes
nothing. An edited file at the same path becomes a new dataset that `versions_of` links back to
the first — say so rather than presenting it as the same data.

Pass `sensitive: true` for anything with personal data: the profile then records column types,
missing counts and distinct counts, but no cell values. Report the profile as what it is — a
count of what is in the file, not a finding about it.

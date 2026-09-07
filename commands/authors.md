---
description: List, show, add, or learn author voice profiles, and merge them into project-consensus.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude authors $ARGUMENTS --json
```

(`list`; `show <id>`; `add --json '{"id":"researcher-a","language":"en","tone":{…},"sentences":{…},"paragraphs":{…},"transitions":"minimal","terminology":{…}}'`;
`learn <id> --from <path…> [--approved]`; or `consensus`.)

A profile records explicit, human-readable style preferences and, once `learn` has run,
explicit descriptive statistics computed from approved writing samples - never an opaque
embedding. Never invent a profile's fields on the researcher's behalf: ask what tone,
sentence style, and terminology they actually want, or point `learn` at writing they have
already approved.

`consensus` merges every profile into `authors/project-consensus.yaml` for collaborative
projects, and proposes a Decision when the merged result changes. Never approve that Decision
yourself - it is the researcher's call, the same as any other.

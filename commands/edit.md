---
description: Correct the non-identity fields of a recorded, non-canonical object.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude edit $ARGUMENTS --json
```

(An object id, then the fields as JSON: `phdude edit CLAIM-… --json '{"tags":["method"]}'`, or
`--file <path>.json`.)

Three things it will refuse, by design: a **canonical** object (propose a Decision instead), an
**identity field** — the fields the object's id is derived from, such as a claim's `statement`
or a source's `title` and `year` — and any field the schema does not know. Changing an identity
field means recording a different object: use `phdude add` and leave the original as the
history of what was believed.

`state` is not editable here either. Moving an object between states is `phdude promote`, which
is where the state machine and the approved-Decision requirement live.

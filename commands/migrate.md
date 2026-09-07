---
description: Upgrade the workspace to the current schema version.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude migrate --dry-run $ARGUMENTS --json
```

Report the chain and the files each step would rewrite, then ask the researcher to commit or
stash any uncommitted work and confirm before running it for real:

```
phdude migrate $ARGUMENTS --json
```

`migrate` refuses to run on a dirty git tree because git is the only undo; `--force` overrides
that and should only be used when the researcher asks for it. Migrations are idempotent, so
running `migrate` on an up-to-date workspace changes nothing.

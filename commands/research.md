---
description: Search the literature for a research question and review the candidates it returns.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude research $ARGUMENTS --json
```

(A quoted query with optional `--question RQ-n`, `--provider a,b`, `--from YYYY`, `--limit N`
and `--allow-network`; or `list [--state candidate|accepted|dismissed] [--question RQ-n]`; or
`show <CAND-id>`.)

This is the only command allowed to reach the network, and it refuses unless
`.phdude/research-policy.yaml` sets `network.enabled: true` or the call carries
`--allow-network`. Never fetch a paper yourself, and never invent one.

Follow `.phdude/skills/research/SKILL.md` to write the query and to review what came back. That
skill is installed only when `skills.allow_network: true`; without it, still report every
candidate to the researcher by title, venue, year and abstract before anything is accepted.
Candidates are not sources: nothing enters the citation registry until the researcher says so.

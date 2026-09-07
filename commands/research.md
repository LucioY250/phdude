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
`show <CAND-id|SEARCH-id>`; or `accept <CAND-id> [--type article] [--approve-preprint]`; or
`dismiss <CAND-id> --reason "…"`.)

This and `/phdude-research-fresh` are the only commands allowed to reach the network, and both
refuse unless `.phdude/research-policy.yaml` sets `network.enabled: true` or the call carries
`--allow-network`. Never fetch a paper yourself, and never invent one.

`--provider` narrows the policy's `providers:` list; a provider the policy does not list is a
usage error, not a way to reach one more provider.

Follow `.phdude/skills/research/SKILL.md` to write the query and to review what came back. That
skill is installed only when `skills.allow_network: true`; without it, still report every
candidate to the researcher by title, venue, year and abstract before anything is accepted.
Candidates are not sources: nothing enters the citation registry until the researcher says so.

`accept` and `dismiss` record the researcher's verdict, one candidate at a time. Never run
either on your own initiative, and never pass `--approve-preprint` until the researcher has
said yes to that specific preprint. A dismissal needs a real reason: it is what tells the next
reader the paper was looked at rather than missed.

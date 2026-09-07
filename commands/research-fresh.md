---
description: Re-run the literature searches that have gone stale, and report only what is new.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude research-fresh $ARGUMENTS --json
```

(Optionally `--question RQ-n` to scope it to one question, `--all` to re-run every recorded
search rather than only the stale ones, and `--allow-network` when the policy is still closed.)

Each stale search is re-run exactly as it ran the first time: the same query, providers and
filters, read back off its `SEARCH-…` record. Only *new* candidates are reported; finding the
same literature again is the answer "nothing has changed".

This reaches the network, so the same rules as `/phdude-research` apply: it refuses unless
`.phdude/research-policy.yaml` sets `network.enabled: true` or the call carries
`--allow-network`, and never pass that flag on your own initiative. Follow
`.phdude/skills/research/SKILL.md` to review whatever came back, and remember that a candidate
is not a source until the researcher accepts it.

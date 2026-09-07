---
name: decisions
description: Propose changes to canonical research decisions and route them through researcher approval before anything is promoted.
phdude:
  version: 1
  reads: [decisions/**, knowledge/**, research/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# Decisions

Follow `[[phdude-core]]`: canonical objects change only through an approved Decision. You never
approve one yourself.

## Propose

```
phdude decide propose --title "Adopt 312 as canonical sample size" \
  --rationale "..." --affects FACT-xxxxxxxxxx --change '{"fact_key":"sample_size","canonical_value":312}' --json
```

A good rationale states: what evidence motivates the change, what alternatives were considered
and why they were rejected, and what would need to be true for the decision to be wrong. Keep
`--change` a minimal, literal description of the edit (e.g. `fact_key`/`canonical_value` for a
fact conflict, or the field being promoted for a claim).

## Approve — the researcher's step, not yours

```
phdude decide approve DEC-xxxxxxxxxx --by <researcher name>
```

Never run `decide approve` on the researcher's behalf unless they explicitly said so in this
conversation ("yes, approve it", "go ahead and approve DEC-..."). When they do, record `--by`
with their actual name, not `ai` or your own name. If they only discussed the decision without
approving it, leave it `proposed` and say so.

A decision may also be rejected (`phdude decide reject DEC-x --by <name>`) — treat a rejection
the same way: only on the researcher's explicit word.

## Promote

Once a Decision is `approved`, promote the object it affects:

```
phdude promote CLAIM-xxxxxxxxxx --decision DEC-xxxxxxxxxx --json
```

This fails (exit code 3) unless the Decision is approved and lists the object in `affects`. Do
not attempt to work around that failure by editing files.

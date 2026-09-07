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
  --rationale "..." --affects FACT-0123456789 --change '{"fact_key":"sample_size","canonical_value":312}' --json
```

A good rationale states: what evidence motivates the change, what alternatives were considered
and why they were rejected, and what would need to be true for the decision to be wrong. Keep
`--change` a minimal, literal description of the edit (e.g. `fact_key`/`canonical_value` for a
fact conflict, or the field being promoted for a claim).

## Approve — the researcher's step, not yours

```
phdude decide approve DEC-0123456789 --by <researcher name>
```

Never run `decide approve` on the researcher's behalf unless they explicitly said so in this
conversation ("yes, approve it", "go ahead and approve DEC-..."). When they do, record `--by`
with their actual name, not `ai` or your own name. If they only discussed the decision without
approving it, leave it `proposed` and say so.

A decision may also be rejected (`phdude decide reject DEC-x --by <name>`) — treat a rejection
the same way: only on the researcher's explicit word.

## Supersede

An approved decision is never rejected; it is replaced. Propose the replacement first, then:

```
phdude decide supersede DEC-old --by <researcher name> --with DEC-new
```

`--by` is the researcher, exactly as on `approve` and `reject`; `--with` is the decision that
replaces the old one. Passing the new decision's id to `--by` is the v0.1 form and exits 1.

## Promote

Once a Decision is `approved`, promote the object it affects:

```
phdude promote CLAIM-0123456789 --decision DEC-0123456789 --json
```

This fails (exit code 3) unless the Decision is approved and lists the object in `affects`. Do
not attempt to work around that failure by editing files.

## Resolving a contradiction

`phdude link CLAIM-a --contradicts CLAIM-b` (see `[[phdude-core]]`) moves both claims to
`disputed` automatically — that step needs no Decision. A single Decision must never
rehabilitate both sides of a dispute, so resolving one names exactly one survivor:

1. Propose a Decision whose `change` carries both `resolves_contradiction` (the ids in the
   pair) and `survivor` (which one wins), e.g. `--change
   '{"resolves_contradiction":["CLAIM-a","CLAIM-b"],"survivor":"CLAIM-a"}'` with `--affects
   CLAIM-a CLAIM-b`, and a rationale that states which claim the evidence favors and why.
2. The researcher approves it, exactly as any other Decision (see Approve, above).
3. Reject the losing claim(s) first: `phdude promote CLAIM-b --to rejected` — this needs no
   Decision, same as any other `disputed → rejected` move. The survivor cannot be promoted
   while a claim the Decision names is still `disputed`.
4. Promote the survivor: `phdude promote CLAIM-a --to supported --decision DEC-x` (or
   `--to canonical`). This fails with POLICY unless the id being promoted is exactly the
   Decision's `survivor`, is in `affects`, and every other claim the Decision names that this
   claim still contradicts is already `rejected`. Promoting the loser with the same Decision
   is refused, naming the survivor instead of it.

Never reorder steps 3 and 4 to promote a claim while its contradicting partner is still
`disputed` — that is exactly what this gate prevents. Promoting the survivor does not touch
any other claim automatically, and the `contradicts` entry is never removed — it stays on the
survivor as a record that the dispute existed and how it was resolved. Never silently pick a
side by promoting one claim and leaving the other `disputed` with no explanation.

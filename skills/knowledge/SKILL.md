---
name: knowledge
description: Query and trace the knowledge graph - claims, evidence, facts, sources, questions, hypotheses - and explain what state each object is in.
phdude:
  version: 1
  reads: [knowledge/**, research/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# Knowledge

Follow `[[phdude-core]]`: this skill is read-only, and state names must shape your wording.

## Listing

```
phdude knowledge list --json
phdude knowledge list --type claim --state candidate --json
phdude knowledge list --query "sample size" --json
```

`--type` filters by object type (`claim | evidence | fact | source | question | hypothesis |
result`). `--state` filters by knowledge state. `--query` is a case-insensitive substring match
over the object's primary text. Use filters before reading — never dump the whole knowledge
base into context.

## Showing one object

```
phdude knowledge show <id> --json
```

Returns the full object. Report its `state` alongside its content, not just the content.

## Tracing lineage

```
phdude knowledge trace <id> --json
```

Returns `{ id, up, down }`:

- `up` — what this object depends on (e.g. a claim's evidence, and that evidence's source).
- `down` — what depends on this object (e.g. a fact's conflicts, a claim's manuscript sections).

Use `trace` to answer "where did this come from?" or "what breaks if this changes?". When a
researcher asks why a sentence is hedged a certain way, trace the claim to its evidence and read
the evidence's `strength` — that is the answer.

## Describing state to the researcher

Always name the state when you present an object: "CLAIM-3f2a1 (candidate, one moderate
evidence item)" rather than presenting it as settled. If `trace` shows a claim with no upstream
evidence, say so explicitly — it is a gap, not a fact.

---
name: research
description: Search the literature for a research question under the workspace network policy, and review the candidates with the researcher.
phdude:
  version: 1
  reads: [research/questions/**, knowledge/candidates/**, research/searches/**, .phdude/research-policy.yaml]
  writes: []
  permissions:
    network: allowed
    workspace: [read]
---

# Research

Follow `[[phdude-core]]`. This skill is the only one that touches the network, and it does so
through two commands: `phdude research` and `phdude research-fresh`. **Never fetch a paper, an
abstract, a DOI or a citation yourself** — not with a browser tool, not with `curl`, not from
memory. If a recorded search did not return it, it is not a candidate.

This skill is installed only when `.phdude/research-policy.yaml` sets `skills.allow_network:
true`. Searching itself is gated separately, by `network.enabled` (see below).

## Before you search

Read the research question you are searching for:

```
phdude knowledge show RQ-1
```

Then build the query from three things, in this order:

1. **The question's own words.** The nouns the researcher wrote are the nouns the literature
   uses. Do not paraphrase them into your own vocabulary.
2. **Key terms.** The concepts the question names, plus the obvious synonyms a field uses for
   them. Two or three, not ten — a long query returns worse results, not better ones.
3. **Method terms from the applied packs.** `phdude packs list` shows which packs are applied;
   a quantitative pack means terms like `survey`, `regression`, `randomized`, a qualitative one
   means `interview`, `thematic analysis`, `case study`. Add them only when the question is
   about how something was studied, not about what was found.

Keep the query short and literal. `phdude research` sends the query string and nothing else.

## Running the search

```
phdude research "open science practices adoption" --question RQ-1 --json
```

| Option | When to use it |
| --- | --- |
| `--question RQ-n` | Almost always. It ties every candidate to the question, and it is what freshness tracking keys on. |
| `--provider a,b` | To narrow to a subset of the configured providers, e.g. `--provider pubmed` for a clinical question. It can never widen beyond what the policy lists. |
| `--from YYYY` | To override the policy's `year_range.from` for one search. |
| `--limit N` | To override the policy's `research.limit` per provider. |
| `--allow-network` | Only when the researcher has just told you to search and the policy is still closed. |

**Do not pass `--allow-network` on your own initiative.** With `network.enabled: false` the
command refuses, and that refusal is the researcher's decision, not an obstacle. Report it and
ask; do not route around it.

Run one search per question, not one per provider: the command already calls every configured
provider and merges what they return. A provider that fails is reported as a warning and the
others still count — say so rather than re-running the whole search.

## Reviewing what came back

A candidate is **not** a source. It is a hit a provider returned, and nothing enters the
citation registry until the researcher accepts it.

```
phdude research list --state candidate --json
phdude research show CAND-… --json
```

Report each candidate to the researcher with, at minimum:

- **title**, **venue**, **year**, and the **authors**;
- the **abstract**, or the plain fact that the provider did not return one;
- `providers` — which sources agreed this work exists;
- `cited_by` and `open_access` when the provider reported them, and "not reported" when not.

**Never accept a candidate whose abstract you have not read.** If the provider returned no
abstract, say so and let the researcher decide whether that is enough. Never fill in a missing
year, venue, author or DOI from memory — a field the provider did not return stays empty.

`score` and `score_parts` explain the ordering (provider rank, citation count, recency). It is
a sorting aid, not a judgment: a low-scoring candidate that answers the question outranks a
high-scoring one that does not. Say why a candidate matters to the question, in one line, and
let the researcher decide.

### `needs_approval`

A candidate with `needs_approval: true` is a preprint, and the policy says preprints need the
researcher's explicit approval (`preprints.require_approval`). Flag it as a preprint every time
you report it. Never present one as peer-reviewed, and never let it pass in a batch of
"looks fine".

## Accepting and dismissing

Every candidate ends in one of two places, and **the researcher decides which**. Your job is to
report and then to execute what they said, one candidate at a time.

```
phdude research accept CAND-… --json
phdude research dismiss CAND-… --reason "measures a different construct" --json
```

`accept` creates the `SRC-` record: the candidate's title, authors, year, venue, abstract and
type, plus whatever identifiers the providers reported (`doi`, `url`, `arxiv`, `pmid`). It
records where it came from in `ext.research` and links the candidate to it with `accepted_as`.
It never invents a missing field — run `phdude cite check` afterwards and report what is still
missing rather than filling it in from memory.

`--type` overrides the type the provider reported; use it only when the researcher corrects it
(a "report" a provider called an "article", say), never on a hunch.

`dismiss` needs a real reason, and "not relevant" is not one. Say what about the paper does not
fit: the population, the construct, the design, the date range. A dismissed candidate comes back
in every future search, and the reason is what tells the next reader it was read, not missed.

Both refuse a candidate that was already accepted or dismissed. That is not an obstacle to work
around: it means the verdict is already recorded, so read it (`phdude research show CAND-…`) and
report it instead of overwriting it.

### `--approve-preprint`

A candidate flagged `needs_approval` is a preprint, and `accept` refuses it without
`--approve-preprint`. Pass that flag **only after the researcher has said yes to that specific
preprint**, in this conversation, having been told it is a preprint. Never pass it to clear an
error, never pass it for a batch, and never pass it because the paper looks good to you. The
flag is the researcher's answer, not your workaround.

## Keeping the literature current

```
phdude freshness --json
phdude research-fresh --question RQ-1 --allow-network
```

`freshness` is read-only and never touches the network: it reports the last search per question,
how long ago it ran, and whether the policy calls that stale (`research.freshness
.stale_after_days`). A question nobody has searched is stale by definition.

`research-fresh` re-runs the stale searches exactly as they ran the first time and reports
**only new candidates**. Nothing new is a real answer — say "nothing has changed since the
search in March" rather than re-listing the same papers. Review whatever is new the same way as
any other candidate. `--all` re-runs everything regardless of age; use it only when the
researcher asks, since it spends provider calls on searches that are not due.

## Reporting to the researcher

In 10 lines or fewer: how many candidates the search produced and how many were already
recorded, the two or three most relevant with title, year, venue and one line on why, every
preprint flagged, and any provider warning. Then ask which to accept. Do not accept, dismiss,
or add a source on your own.

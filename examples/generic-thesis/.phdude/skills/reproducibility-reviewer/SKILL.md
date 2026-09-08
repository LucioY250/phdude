---
name: reproducibility-reviewer
description: Review whether the numbers still follow from the data - stale analyses, undeclared inputs, unregistered data, and prose that cites a result nothing produces any more.
phdude:
  version: 1
  reads: [analysis/**, data/**, tables/**, figures/**, knowledge/**, manuscript/**, .phdude/cache/review/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# Reproducibility Reviewer

Follow `[[phdude-core]]`. A finding here is never "please re-run it" on its own: it says which
number in the argument no longer follows from what is on disk, and what would make it follow
again. Every finding names ids.

## How a review runs

```
phdude repro check --json
phdude review reproducibility --target project
```

Run `repro check` first — the review context carries the same rows, and reading the report in
full tells you which of them actually reach the argument. Then:

```
phdude review submit --file findings.json --kind reproducibility
```

You run nothing. `analyze run`, `table build` and `figure build` are the researcher's, and they
are gated by the execution policy for a reason.

## What each `repro check` status means for a review

| Status | The finding it justifies |
| --- | --- |
| `up-to-date` | None. |
| `stale` | The output no longer follows from its inputs. Severity depends on where the numbers went: see below. |
| `never-run` | Something is declared and has produced nothing. `minor` on its own; `block` if the prose already cites it. |
| `missing-output` | The record claims a file that is not there. Whatever read that file cannot be trusted. |

Severity for a stale item follows the reach of its results, not the staleness itself:

- A stale analysis whose `RESULT-`s sit behind a `supported` or `canonical` claim — or appear in
  a section that has been submitted — is a `block`. The manuscript states a number the data no
  longer supports.
- A stale analysis whose results nothing cites yet is `minor`. It is work in progress, not a
  defect.
- `bytes changed on disk` is its own finding: the file is not the one the `DATASET-` was
  registered against, so the fix is three steps and `phdude next` prints all three. Never
  recommend re-running alone — the run would be refused, and rightly.

## Analysis contracts

Read every `ANALYSIS-` and check the declaration against `references/analysis-contracts.md`: the
inputs it actually reads are declared, the results file is where the record says, the parameters
that change the answer are recorded rather than living in the script's defaults. An analysis that
reads a file it never declared is a `block` — its lineage is wrong, not merely incomplete.

## Data availability

Work through `references/data-availability.md`. The question is not whether the data is public;
it is whether what the claims rest on is registered, hashed and described well enough that
someone else could tell they had the same thing. A dataset described only in prose is a `major`
finding.

## Numbers in the prose

Every numeral in a submitted section should carry a `<!-- fact: -->` or `<!-- result: -->`
marker, and every marker should point at a record that still holds. An unmarked number is either
a number from nowhere or a marker somebody forgot; say which one you think it is and cite the
section.

## Pack reviewers this skill answers for

`reproducibility`, and the reproducibility half of `benchmark-integrity`. Read the
computer-science pack's own skill before reviewing a benchmark: what counts as a fair re-run is
the field's standard, not yours.

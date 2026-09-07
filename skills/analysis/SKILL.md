---
name: analysis
description: Declare, run and report an analysis over the workspace's datasets, under the execution policy, recording every finding as a RESULT.
phdude:
  version: 1
  reads: [analysis/**, knowledge/datasets/**, knowledge/results/**, research/questions/**, research/methods/**, .phdude/research-policy.yaml]
  writes: []
  permissions:
    network: none
    execution: allowed
    workspace: [read]
---

# Analysis

Follow `[[phdude-core]]`. This skill is installed only when `.phdude/research-policy.yaml` sets
`skills.allow_execution: true`, and even then a run is gated separately by `execution.enabled`.

**Never run a script yourself.** Not with Bash, not with a notebook, not "just to check the
numbers". `phdude analyze run` is the only thing allowed to execute a researcher's code, and it
is the only thing that records what came back. A number you produced outside it is not a
finding — it is an unrecorded claim with no run behind it.

PhDude assumes nothing about statistics. The method is the researcher's and the applied packs';
this skill is how a method becomes a reproducible object.

## The seven steps (PRD §26)

### 1. Understand the question

```
phdude knowledge show RQ-1
phdude knowledge list --type method
```

An analysis answers a question the workspace already holds. If none does, that is the finding:
say so and stop. Do not invent the question the analysis would answer.

### 2. Inspect the evidence you actually have

```
phdude data list
phdude data profile DATASET-…
```

The profile is a count of what is in the file — rows, column types, missing cells, distinct
values — never a finding about it. Read it before proposing a method: a column of 40 distinct
strings is not a scale, and 12 rows will not carry a regression. Say what the data cannot
support **before** anyone writes the script.

A dataset marked `sensitive` has no sample values in its profile. Do not ask for them, and do
not print cell values into the conversation.

### 3. Recommend a method, and say why

Name the method, the assumptions it makes, and what it would take to violate them. The applied
method packs (`phdude packs list`) say what the field expects; where they are silent, say that
you are choosing rather than reporting a convention.

### 4. Explain the assumptions before the run, not after

Write them down where the researcher can disagree with them. An assumption that only appears in
the interpretation of a result is an assumption nobody got to refuse.

### 5. Perform it reproducibly

Declare the analysis, then run it:

```
phdude analyze add --json '{"name":"describe survey","runtime":"node","script":"analysis/describe.mjs","inputs":["DATASET-8f0a1c2b3d"]}'
phdude analyze run ANALYSIS-… --json
```

The script's side of the contract:

- it reads its inputs from `data/`, and gets `PHDUDE_WORKSPACE` and `PHDUDE_ANALYSIS` in its
  environment — nothing else of the researcher's shell reaches it;
- it lives under `analysis/`, and a path that leaves that directory is refused;
- it writes `{"results":[{"key":"…","summary":"…","values":{…},"unit":"…"}]}` to the path the
  analysis declares, by default `analysis/out/<name>/results.json`;
- the `summary` is the identity of a finding. Put the number in it — `Mean respondent age is
  38.4 years`, not `Mean age` — or a re-run with new data corrects the record in place instead
  of superseding it, and the history of what was believed is lost.

A run whose inputs have not changed since the last successful one is refused as up to date.
That is information: the numbers would be the same. Reach for `--force` only when the researcher
asks. A run refused for policy (`script execution is disabled`) is not a problem to route
around: tell the researcher which setting opens it and let them decide.

### 6. Verify the output

```
phdude analyze runs ANALYSIS-…
phdude knowledge list --type result
```

Check the exit code, the recorded input hashes and what the run actually wrote. A run that
failed is recorded with its stderr — read it before guessing. Then read the results against the
data: a mean outside the column's range, an n larger than the row count, or a result the script
reported for a column the profile says is empty means the script is wrong, not the data.

### 7. Identify the limitations

Every analysis has them, and they belong next to the finding rather than in a footnote nobody
reads. Sample size, missing cells, the design's own limits, what the method cannot rule out.
`phdude knowledge show METH-…` holds the ones the researcher already recorded.

## Reporting a result

A `RESULT-` is a candidate until the researcher decides otherwise. Report it as the analysis
stated it, with its units, and let the number be the number: do not call an effect significant
the script did not test, do not translate a correlation into a cause, and do not round a p-value
into a story. Turning a result into a claim is `phdude add claim` plus evidence that cites it,
and promoting it is a Decision the researcher approves.

When a result supersedes an earlier one, say which and why the data changed. The old record
stays, marked `rejected` with `superseded_by`, because what was believed is part of the record.

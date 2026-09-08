# Analysis contracts

What a declared analysis owes, and what to report when it does not deliver it.

## The declaration

| Field | What to check | Finding when it fails |
| --- | --- | --- |
| `runtime` | Named and installed, or the run cannot happen at all | `minor` — the record is fine, the machine is not |
| `script` | Under `analysis/`, and the file exists | `block` — nothing can reproduce |
| `inputs` | Every `DATASET-` the script actually reads is listed | `block` — the lineage is wrong, not incomplete |
| `outputs.results` | The path the run writes `results.json` to | `major` — results cannot be traced to a run |
| `outputs.files` | Every other file the script writes | `minor` — untracked output |
| `params` | Every value that changes the answer is recorded here, not defaulted in the script | `major` — the run is not the run that was described |

## The runs

- A `runs[]` entry records the input hashes it read and the output hashes it wrote. An analysis
  with results but no run behind them is a record of an answer with no question.
- The last successful run is what staleness is measured against. A failed run does not make an
  item stale; it makes it un-run.
- Two runs that read the same inputs and produced different values mean something outside the
  declaration is moving: a seed, a clock, a network call, an unrecorded parameter. That is a
  `block` and the finding should name which of the four you suspect.

## Determinism

Ask, for each script: run twice on the same bytes, would it produce the same `results.json`?
Randomness without a recorded seed, wall-clock time in the output, ordering that depends on
filesystem iteration, and floating-point accumulation over an unordered set are the usual four.
The finding is the missing seed or the unordered reduction, not "the script is not deterministic".

## The results file

`results.json` is a contract, not a dump: each entry is a finding with a `summary` and its
`values`. A results file whose summaries restate the column names, or whose entries duplicate a
key, produces `RESULT-` records nobody can cite. Report it against the analysis, not the results.

---
name: computer-science
description: Method guidance and review questions for computer science and software engineering research - algorithms, systems, and applied AI/ML studies.
phdude:
  version: 1
  reads: [knowledge/claims/**, knowledge/evidence/**, knowledge/facts/**, research/questions/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# Computer Science Field Pack

Follow `[[phdude-core]]`. This pack refines vocabulary and review questions for computer
science and software engineering work; it does not change the core evidence rules.

## What counts as evidence here

- **Theoretical results** - proofs, complexity bounds, correctness arguments.
- **Empirical results** - benchmark scores, ablations, user studies, profiling data.
- **Artifacts** - released code, datasets, reproducible pipelines.

A claim backed only by a demo or an anecdote from one run is `candidate`, not `supported`.

## Common methodologies

- **Algorithmic analysis** - asymptotic complexity, correctness proofs, worst/average case.
- **Empirical software engineering** - repository mining, controlled experiments with
  developers, static/dynamic analysis studies.
- **Systems benchmarking** - throughput/latency measurement under stated hardware and load.
- **ML experiments** - training/validation/test splits, baselines, ablations, seeds.

## Review questions

- Is the baseline a genuinely competitive, current method, not a strawman?
- Are ablations reported for every component the paper claims matters?
- Was the benchmark/test set held out from training and tuning?
- Are hardware, software versions, and hyperparameters specified well enough to reproduce
  the result?
- Is variance across seeds/runs reported, or is a single run presented as the result?
- For systems claims, is throughput/latency reported with the load profile and hardware that
  produced it, not as a hardware-independent absolute?
- Is code or data available, or is reproducibility asserted without an artifact?

## Epistemic norms

A benchmark result licenses a claim scoped to that benchmark and setup ("the model outperforms
baseline X on benchmark Y under condition Z"), not a general capability claim ("the model is
better at the task"). A mathematical proof of a complexity bound licenses a strong, unhedged
claim ("this algorithm runs in O(n log n)"); a measured latency or throughput number licenses
only an observed claim tied to the tested hardware and inputs ("observed on hardware H"), not a
general performance guarantee. Prefer "observed," "measured," or "outperformed on benchmark X"
over "proves" or "demonstrates" for empirical results; reserve "proves" for actual theorems.
When only one run or one dataset supports a result, say so explicitly rather than implying
robustness that was not tested.

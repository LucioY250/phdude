---
name: figures
description: Declare, build and check figures - the dataviz rules a thesis figure has to meet, the alt text it cannot be published without, and how a figure is generated reproducibly rather than drawn by hand.
phdude:
  version: 1
  reads: [figures/**, knowledge/**, analysis/**, data/**]
  writes: []
  permissions:
    network: none
    execution: allowed
    workspace: [read]
---

# Figures

Follow `[[phdude-core]]`. This skill is installed only when `.phdude/research-policy.yaml` sets
`skills.allow_execution: true`, because `phdude figure build` spawns a generator; even then the
build is gated separately by `execution.enabled`.

A figure in this workspace is a record, not an image you produced: it
declares what draws it, from what, and what it shows, and `phdude figure build` runs the
generator and records the hashes. You never draw a figure yourself, never run a generator
yourself, and never write a file under `figures/out/`.

## One figure, one message

A figure exists to make one comparison a reader can make in a glance. Before declaring one,
write the sentence it is for. If you cannot, the figure is not ready — or the finding belongs in
a table (`[[phdude-core]]`, `phdude table`) or in a sentence.

That sentence is the alt text, and it is the caption's job too. "Bar chart of weight by group"
describes the ink. "Group b averages 4.1 kg more than group a" is the finding. Write the second
one.

## The rules

- **Alt text is required, always** (PRD §100). It states the finding, in one sentence, for a
  reader who cannot see the figure. `phdude figure add` refuses a figure without it, and
  `phdude figure check` reports any that lost it.
- **Label the axes, with units.** A number with no unit is not a measurement.
- **Never 3D, never a shadow, never a gradient.** Perspective distorts the very lengths and
  areas the reader is being asked to compare.
- **Colour must not be the only encoding.** Around one man in twelve cannot separate red from
  green. Where the axis already names the categories, one colour for every bar is the honest
  choice — a second encoding of the same thing costs a reader and tells nobody anything. Where
  colour does carry meaning, use a colourblind-safe palette and pair it with a second channel:
  a label, a shape, a position.
- **Start a bar chart's value axis at zero.** A truncated axis exaggerates a difference the
  data does not hold. Lines may be truncated; bars encode length, so they may not.
- **Show the data, not a decoration.** No chartjunk, no background image, no legend that
  repeats what the axis already says.
- **Say what n is** in the caption, and what the error bars are if there are any.

## Declaring a figure

```
phdude figure add --file figure.json
phdude figure list
phdude figure show FIG-…
```

The declaration is `name`, `caption`, `alt`, `generator`, `inputs` and `outputs`:

- `generator.script` is `phdude:bar-chart` — the accessible SVG generator PhDude ships — or a
  script the workspace holds under `figures/`. Nothing else runs.
- `generator.runtime` is resolved through `execution.runtimes` in the research policy, so the
  workspace decides what may be spawned, not the figure.
- `inputs` are the `RESULT` and `DATASET` ids the figure is drawn from. They are what makes the
  figure go stale when the data moves, so name every one of them even when the generator reads
  a path rather than an id.
- `outputs` are the files the generator writes, all under `figures/`. PhDude checks each one
  exists after the run and hashes it; a generator that exits 0 without writing them has failed.

The shipped generator takes `--input <results.json|dataset.csv> --key <result key|column> --out
<path> --title <title> --alt <alt>`. From a results.json it plots one bar per key of the named
result's `values`; from a csv or tsv column it plots one bar per distinct value, its height the
number of rows holding it. It writes a `<title>`, a `<desc>` carrying the alt text, labelled
axes and no external font.

## Building and checking

```
phdude figure build FIG-…
phdude figure check
```

`build` refuses unless the workspace policy sets `execution.enabled: true` or the researcher
passes `--allow-exec`. That refusal is the researcher's decision to make, not an obstacle to
route around: report it and stop.

Every build is recorded, including the ones that fail. A non-zero exit, a timeout, or a
generator that wrote nothing all leave a run on the record with its exit code — so a reader can
see the figure was attempted and did not render.

`check` reports what needs doing before a figure is cited: `never-run`, `missing-output`,
`stale` (an input has changed since the build that used it), and `missing-alt`. Run it before
putting a figure in a section, and rebuild rather than citing a stale one.

## Writing about a figure

Cite the finding, not the file. In prose, the claim rests on the `RESULT` the figure draws — the
figure shows it, it does not establish it. Say what the figure shows in the text too: a reader
skimming should not have to reconstruct the message from the ink, and a reader using a screen
reader has only your sentence.

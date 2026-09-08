---
name: venue-adapt
description: Move a manuscript from one venue to another - read the adaptation plan, decide what the unmapped sections become, and cut the sections that no longer fit through the writing gates rather than by hand.
phdude:
  version: 1
  reads: [manuscript/**, knowledge/**, figures/**, packs/venues/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# Venue adaptation

Follow `[[phdude-core]]`, `[[write]]` and `[[academic-prose]]`. A thesis chapter is not an IEEE
paper, and PhDude will not pretend otherwise: `phdude adapt` says what the move would cost, and
the cutting is a writing job that goes back through the gates.

## Read the plan first

```
phdude adapt --to ieee --json
```

Nothing is written. The plan carries six things, and every one of them is a question for the
researcher rather than an instruction for you:

| Key | What it says | What it asks of you |
| --- | --- | --- |
| `mapping` | which section becomes which | a row with `to: null` is a section the venue has no place for; a row with `from: null` is one it requires that the manuscript does not have |
| `limits` | words against the target's limit per section | a positive `delta` is words that have to go |
| `abstract` | the same, for the abstract | venues are strictest here — 250 words at IEEE against a thesis's 500 |
| `figures` | a figure in a format the venue does not take | `phdude build` converts SVG to PDF when `rsvg-convert` is installed; otherwise the figure needs another declared output |
| `terminology` | words the venue renames, and how often the prose uses them | IEEE writes `Fig.` where a thesis writes `Figure` |
| `citation_style` | the reference style that takes over | the build applies it through the venue's CSL; you never reformat references by hand |

## The unmapped sections are the researcher's call

A section the venue does not list — a `discussion` going to a venue that folds it into the
results, an `appendix` a conference does not take — is reported as **needs decision** and nothing
more. Do not merge it into another section, do not delete it, and do not invent a mapping the
venue pack does not declare. Say which sections need a decision and what the options are: fold it
into a named section, cut it, or move it to supplementary material. If the venue really does have
a name for it, the fix is a `synonyms` entry in the venue pack (see
[docs/extending.md](../../docs/extending.md)), not a guess at run time.

## Applying the plan

```
phdude adapt --to ieee --apply
```

This writes one file, `manuscript/manuscript.ieee.yaml`: the same section files under the venue's
ids, titles and order. It does not touch `manuscript/manuscript.yaml`, and it does not touch a
single `.md` under `manuscript/`. **Adapt never rewrites prose.** Run it only when the researcher
has said the work is going to that venue.

Sections over the venue's limit come out `revised` and lose their approval, because an approval
was for text at a length this venue will not take. That is the point of the file: it is a work
list, not a finished manuscript.

## Then do the actual work

For each section the plan marks `revised`:

```
phdude deslop <section> --json
phdude deslop <section> --file revised.md
```

The meaning gate refuses a revision that drops a claim, a citation, a number or a negation — so
cutting to a word limit means cutting **words**, not findings. If the section cannot reach the
limit without losing a claim, that is the finding to report: the venue may be the wrong one, or
the claim belongs in another section. Never delete a claim marker to make a count fit.

For the terminology, change the words in the prose you are already revising. Do not do a
find-and-replace pass over approved sections for it alone — every change to `manuscript/` goes
through `phdude manuscript submit` or `phdude deslop --file`, gates included.

## Check before you report done

```
phdude profile check --profile ieee --json
```

That is the report that says whether the manuscript now meets the venue, and it exits 2 while
anything blocks. `phdude adapt` states a plan; `profile check` states the verdict; `phdude build
--profile ieee` produces the file. Never claim a manuscript is ready for a venue on the strength
of the plan alone.

One thing to be precise about when you report: `phdude build` reads
`manuscript/manuscript.yaml`, not the adapted file. Building for a venue applies that venue's
order, headings, citation style and template to the canonical section list.
`manuscript.<venue>.yaml` is the record of the mapping and the list of sections that still owe a
revision.

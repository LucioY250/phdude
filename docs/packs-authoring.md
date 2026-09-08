# Writing a PhDude pack

A pack is how PhDude adapts to a discipline without the core ever branching on one. It carries
vocabulary, reviewer perspectives, recommended checks, detection keywords and bundled skills —
and, for a venue, the profile a manuscript is checked against. It is data: YAML and Markdown,
never executable code, and nothing in it is ever run.

Three kinds:

| Kind | Answers | Ships |
| --- | --- | --- |
| `field` | What discipline is this? | `business`, `computer-science`, `humanities`, `medicine` |
| `method` | How is the work done? | `qualitative`, `quantitative`, `systematic-review` |
| `venue` | Where is it going? | `generic-thesis`, `ieee`, `acm` |

A field and a method pack carry guidance. A venue pack carries validation data instead: no
detection keywords and no skills, because a venue is a decision the researcher makes about where
the work is going, not something to read off the corpus.

[Extending PhDude](extending.md) is the map; [docs/extension-api.md](extension-api.md#researchpack)
is the reference. This page is how to write the files.

## Where a pack lives

```
packs/<kind>s/<name>/          # shipped with PhDude
.phdude/packs/<kind>s/<name>/  # added by a workspace
```

`discoverPacks` walks the package's `packs/` first and the workspace's `.phdude/packs/` second, so
a workspace pack with the name of a built-in one overrides it. Nothing has to be registered, no
code changes, and PhDude does not have to be reinstalled: a pack is the one extension a workspace
adopts entirely on its own.

## A field or method pack

```
my-field/
├── pack.yaml
└── skills/
    └── my-field/
        └── SKILL.md
```

```yaml
schema: phdude.pack
version: 1
name: my-field
kind: field                  # field | method | venue
description: >-
  One or two sentences: the discipline, and what this pack changes about how
  PhDude reads and writes for it.
terminology:                 # vocabulary the agent should prefer here
  - sociotechnical
  - boundary object
  - situated knowledge
detect:
  keywords:                  # scored against cached text by `phdude packs detect`
    - sociotechnical
    - laboratory study
    - actor-network
reviewers:                   # reviewer perspectives this discipline expects
  - reflexivity
recommended_checks:
  - positionality-statement
  - fieldwork-consent
skills:                      # paths relative to the pack directory
  - skills/my-field/SKILL.md
schemas: []                  # optional extra JSON Schemas for ext.<pack> fields
```

Validated against [`schemas/pack.json`](../schemas/pack.json) (`$id: phdude://pack`). Every key
listed is required and `additionalProperties: false` applies, so an unknown key is a validation
error rather than a silently ignored typo.

Rules the loader enforces:

- `name` matches `^[a-z0-9-]+$` and is unique per discovery root.
- Every path in `skills` exists and resolves **inside** the pack directory. An absolute path, a
  `..`, a NUL byte, and a symlink pointing out of the pack are all `VALIDATION` errors.
- Core schemas stay untouched. A pack may add fields only under `ext.<pack>`.

Sizes the shipped packs keep, and which
[`tests/contracts/packs.test.js`](../tests/contracts/packs.test.js) enforces on everything under
`packs/`: 8–15 detection keywords, at least 3 terminology entries, 1–3 reviewers, 2–4 recommended
checks. They are not schema constraints, so a workspace pack outside them still loads — but they
are what keeps detection from matching everything and a reviewer list from becoming a wish list.
Hold your own pack to them.

### Detection

`phdude packs detect` scores each pack's keywords against the cached text of the corpus and
records the recommendation in `phdude.yaml`. It **recommends and never applies**: adopting a pack
stays a decision the researcher makes. Choose keywords a member of the field would actually write
and an outsider would not — a term that appears in every discipline's methods section will match
every corpus and tell nobody anything.

### The skill

A field or method pack bundles at least one skill, and that skill is where the discipline's
epistemic norms belong: what counts as evidence, what wording each design licenses, what a
reviewer in this field asks first. Its front-matter `name` must equal its directory name, and its
`phdude:` block goes through the same contract every skill does. See
[docs/skills-authoring.md](skills-authoring.md).

`phdude packs apply <name>` checks every bundled skill before recording anything, and refuses the
whole pack with `POLICY` if one asks for a permission the research policy has not opened.

## A venue pack

```
ieee/
├── pack.yaml                # kind: venue, detect.keywords: [], skills: []
├── profile.yaml             # schema phdude.profile v1
├── csl/ieee.csl             # the citation style, vendored
└── templates/IEEEtran.tex   # a minimal pandoc LaTeX template
```

```yaml
schema: phdude.profile
version: 1
name: ieee                    # must equal the directory it lives in
display: IEEE conference paper
description: >-
  The IEEE conference template.
document_class: IEEEtran      # what the LaTeX template declares
citation_style: csl/ieee.csl  # a CSL file in the pack, or the name of a style the renderer knows
sections:                     # what the venue expects, in the order it expects it
  - id: abstract
    title: Abstract
    required: true
    order: 1
  - id: introduction
    title: Introduction
    required: true
    order: 2
    max_words: 1200
    synonyms: [intro, background, related-work]
abstract:
  max_words: 250              # the abstract inherits this unless it sets its own max_words
page_limit: 8                 # reported, not enforced: pages are a rendering fact
figures:
  formats: [pdf, png]
  min_dpi: 300
tables:
  style: ieeetran
references:
  style: IEEE
templates:
  latex: templates/IEEEtran.tex
writing:
  first_person: sparing       # never | sparing | natural
  tense_abstract: past
  terminology_map:
    Figure: Fig.
```

Validated against [`schemas/profile.json`](../schemas/profile.json); unknown keys are refused.
`name` must equal the directory. `citation_style` ending in `.csl`, and every path under
`templates`, must exist and resolve inside the pack, under the same rules a pack's skill paths
follow. A `citation_style` that is not a `.csl` path is taken as the name of a style the renderer
already knows and resolves to no file.

A venue directory holding only a `profile.yaml` still loads and still appears in
`phdude profile list`. Add a `pack.yaml` with `kind: venue` if you also want
`phdude packs apply <name>` to record the venue in `phdude.yaml`. A venue pack that ships no
profile is refused, because there would be nothing to check a manuscript against.

### What the profile is checked against

`src/domain/profiles.js` holds the rules and both readers go through it: `gate-profile` runs the
per-section rules on every `manuscript submit`, and `phdude profile check` runs all of them over
the whole manuscript. A section the gate lets through is a section `profile check` lets through.

| Finding | Severity | When |
| --- | --- | --- |
| `section-missing` | block | the venue requires a section the manuscript does not have |
| `section-words` | block | a section's body is over its `max_words` |
| `section-unknown` | warn | the manuscript has a section the venue does not list |
| `section-order` | warn | two sections the venue orders one way sit the other way round |
| `figure-format` | warn | a figure produces no format in `figures.formats` |
| `section-optional` | info | the venue also takes a section the manuscript does not have |
| `section-unwritten` | info | a required section has no prose to measure yet |
| `references-style` | info | the reference style in force |

Word counts come from `domain/textstats.js`, which strips Markdown, `[@key]` citations and
`<!-- claim: -->` markers first, so a citation-dense paragraph is measured as the prose it is.

`synonyms` is read only by `phdude adapt`: it is the venue saying which other names mean this
section, so a manuscript with a `related-work` chapter can be told what that chapter becomes at a
venue that folds it into the introduction. Synonyms never relax `profile check` — a section the
venue does not list is still `section-unknown` there, because the check reports the manuscript as
it is and `adapt` is what proposes the move.

### CSL licensing

The `.csl` files under `packs/venues/*/csl/` come unmodified from the
[CSL styles repository](https://github.com/citation-style-language/styles) and keep their own
`<rights>` element: **CC BY-SA 3.0**, not the MIT licence the rest of PhDude uses. See
[packs/venues/README.md](../packs/venues/README.md).

If you vendor a style into your own venue pack, keep the `<rights>` element intact and say in your
pack's README which licence the file carries. If you need a variant of a style PhDude ships, add
it as a workspace venue pack rather than editing the vendored file.

## Using a pack

```
phdude packs list                 # every discoverable pack, and whether it is applied
phdude packs detect               # score keywords against the corpus and record a recommendation
phdude packs apply my-field       # record it in phdude.yaml and install its skills
```

`apply` adds the pack to `fields`, `methods` or `venues` in `phdude.yaml` and writes one event.
Applying a venue records that the project is *aiming* at it; `phdude profile use <venue>` is what
makes the manuscript target it, and the two are separate because a project can be shopping a
paper at three venues while one manuscript targets one of them.

## Testing a pack

Put it under `packs/` and run the shipped suite, which validates every discovered pack and checks
that each referenced skill file exists:

```
node --test tests/contracts/packs.test.js
```

For a pack that lives outside the package, point the loaders at your root:

```js
import { DEFAULT_PACKS_DIR, discoverPacks, loadPack } from '../../src/adapters/packs/loader.js';

const pack = await loadPack(join(myRoot, 'fields', 'my-field'));
const packs = await discoverPacks([DEFAULT_PACKS_DIR, myRoot]);
```

[`tests/contracts/example-extensions.test.js`](../tests/contracts/example-extensions.test.js) does
exactly that for [`examples/extensions/pack-example/`](../examples/extensions/pack-example/), which
is a complete third-party field pack with one skill. Copy it and edit.

## What a pack cannot do yet

A pack extends vocabulary, recommendations, detection, skills and — for a venue — the profile.
It does not yet extend the writing gates. The banned-phrase, transition and hedge inventories
`gate-prose` uses are per-language tables in `src/domain/lang/<code>.js`, and the verb table
`gate-evidence` enforces is a built-in table in `src/domain/gates/markers.js`. Neither is
pack-extensible.

PRD section 8 describes a `writing.epistemic_norms` list in `pack.yaml` for exactly this, so a
machine-learning pack could say "report results as observed on the evaluated benchmarks; do not
generalize beyond them" and have `gate-evidence` enforce it rather than merely suggest it.
`schemas/pack.json` has no `writing` key and refuses unknown ones, so a pack carrying one fails
validation today. Until it lands, put your field's epistemic norms in the pack's skill, where the
agent will read them.

## Checklist

- [ ] `pack.yaml` validates; `name` matches the directory and collides with nothing.
- [ ] 8–15 detection keywords a member of the field would write and an outsider would not.
- [ ] At least 3 terminology entries, 1–3 reviewers, 2–4 recommended checks.
- [ ] At least one skill, whose front-matter `name` equals its directory, asking for the least it
      needs.
- [ ] A venue pack instead declares `detect.keywords: []` and `skills: []`, and ships a
      `profile.yaml` that validates.
- [ ] Any vendored CSL keeps its `<rights>` element, and its licence is named in your README.
- [ ] `phdude packs list` sees it and `phdude packs apply <name>` records it in a scratch
      workspace.

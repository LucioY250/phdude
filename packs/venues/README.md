# Venue packs

A venue pack is the publication profile of one venue: the sections it expects, the limits it
sets, the citation style it wants, and a minimal LaTeX template for its document class. Three
ship with PhDude:

| Pack | Class | Citation style | Budget |
|---|---|---|---|
| `generic-thesis` | `report` | APA 7th edition (`csl/apa.csl`) | generous; only a runaway section trips it |
| `ieee` | `IEEEtran` | IEEE (`csl/ieee.csl`) | 8 pages, 250-word abstract |
| `acm` | `acmart` (sigconf) | ACM SIG Proceedings (`csl/acm-sig-proceedings.csl`) | 10 pages, 250-word abstract |

Each directory holds `pack.yaml` (`kind: venue`), `profile.yaml` (schema
`schemas/profile.json`), the CSL style under `csl/`, and the template under `templates/`.
`phdude packs apply <venue>` adds the venue to `phdude.yaml`; `phdude profile use <venue>` makes
it the manuscript's target; `phdude profile check` reports what the manuscript does not meet.

Venue packs declare no detection keywords. A venue is a decision the researcher makes about
where the work is going, not something to infer from the corpus, so `phdude packs detect` leaves
them out of its scoring.

To add your own, put it under `.phdude/packs/venues/<name>/` in the workspace; a workspace pack
overrides a shipped one of the same name. See [docs/extending.md](../../docs/extending.md).

## Citation styles

The `.csl` files under each pack come unmodified from the
[Citation Style Language styles repository](https://github.com/citation-style-language/styles)
and each keeps its own `<rights>` element. They are licensed under
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), which is not the MIT licence
the rest of PhDude uses. Redistributing a modified style means keeping it under the same
licence, so if you need a variant, add it as your own workspace venue pack rather than editing
the file here.

## LaTeX templates

The `.tex` files are Pandoc templates, not standalone documents: they use `$body$`, `$title$`
and the `CSLReferences` environment `pandoc --citeproc` writes a bibliography into. They are
deliberately minimal. A conference's own camera-ready template belongs in the workspace's
`templates/` directory, registered with `phdude template add`.

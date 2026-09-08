# Changelog

All notable changes to PhDude are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and PhDude adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Documentation only. Nothing about how PhDude behaves has changed.

### Changed

- **The README is the front page again.** A first reader arrived at 1351 lines of it and said
  what anyone would say: nobody reads that. It is now 66 lines — what PhDude is, an animated
  demo of six real commands, install, an eight-command tour, how to point an agent at it, three
  principles, and where to read more. Everything that was there is in
  [docs/guide.md](docs/guide.md), whole, with its links repointed.

### Added

- **An animated demo, `docs/assets/demo.svg`.** `npm run demo` copies `examples/generic-thesis`
  to a scratch directory, runs `status`, `next`, `research list`, `manuscript status`, `health`
  and `ready` against it with this repository's own binary, and renders what they printed as a
  looping terminal animation. The frames are real output, so the demo cannot drift from the CLI;
  `tests/integration/make-demo.test.js` holds the committed SVG to the same byte parity as the
  example workspaces.

## [1.0.0] — 2026-09-08

Public release. Nothing here is a new research capability; all of it is a promise. Every schema
carries a stability marker and a snapshot that refuses a silent change to its required fields or
enums. Every command in `docs/cli.md` is marked stable, and the exit codes and the `--json` error
envelope are held there by a contract test. The seven extension ports are documented with their
lifecycles, their error behaviour and the contract suites an implementation runs against, and four
example third-party extensions run through those suites in CI. Three more example workspaces — a
social-science survey, a machine-learning benchmark and an archival humanities study — prove the
claim the whole design rests on: the core never branches on the field. What it would cost to break
any of this is written down in [docs/versioning.md](docs/versioning.md).

### Breaking changes since 0.1

Everything below happened between 0.1.0 and 1.0.0, while the surface was still being built. It
is collected here because a workspace started on an early release has to cross all of it at once,
and because from 1.0 on none of it may happen again outside a major release —
[docs/versioning.md](docs/versioning.md) says what is now frozen and what a deprecation costs.

**The workspace format moved four times, and one command carries every step.** `phdude migrate`
walks a workspace from wherever it is to version 5. Since 0.2.0 a read on an out-of-date
workspace still works and warns `workspace needs migration (n → 5)`; a write exits 1 with the
same message and the hint `run phdude migrate`.

| Step | Release | What the workspace gains |
|---|---|---|
| 1 → 2 | 0.2.0 | `provenance` on claims and evidence, `contradicts` on claims (`migrations/0001-workspace-v2.mjs`). |
| 2 → 3 | 0.5.0 | The `execution` block in `.phdude/research-policy.yaml`, the `analysis/` directories, and the derived-output `.gitignore` rules (`migrations/0002-workspace-v3.mjs`). |
| 3 → 4 | 0.6.0 | The venue list in `phdude.yaml` and the empty `.phdude/templates.yaml` registry (`migrations/0003-workspace-v4.mjs`). |
| 4 → 5 | 0.7.0 | `reviews/`, and the `health.weights` and `ready` blocks in the research policy (`migrations/0004-workspace-v5.mjs`). |

Every step is idempotent, writes through the store, appends one `migrate` event, and previews
itself under `--dry-run`. None of them renames an id.

**One object type changed its identity.** In 0.5.0 a `RESULT-` id became derived from its summary
*and* the analysis that produced it, so two analyses can reach the same finding and each keep its
own record. `from` is id material only when it names an analysis: a 0.4.0 result whose `from` held
prose keeps the id computed from its summary alone, migration 0002 rewrites no ids, and re-adding
such a result after migrating finds the record already on disk rather than minting a duplicate.
Every other type's material is unchanged from 0.1.0 — a claim from its statement, evidence from
its source, locator and excerpt, a fact from its key, value and artifact, a decision from its
title, rationale, sorted `affects` and stable `change`.

**Flags renamed, removed or made strict.**

- `phdude decide supersede` takes the replacing decision in `--with`, not `--by` (0.2.0). `--by`
  is the researcher on every subcommand. The old form exits 1 naming the correction rather than
  reporting a missing decision.
- An unrecognised option is refused (0.2.0). `phdude knowledge list --stat candidate` used to
  return the unfiltered list, which reads as an answer; it now exits 1 naming the flag and listing
  what that command accepts.
- `phdude ingest .` walks `sources/` only (0.2.0). An explicit path into `knowledge/`,
  `research/`, `decisions/` or `.phdude/` exits 1 with `not a source path`.
- `phdude edit` treats a result's `from` as an identity field and refuses it (0.5.0). It was
  editable in 0.4.0, when `from` was not part of the id.
- `phdude table build` with no `--format` builds every format the table declares (0.6.0). It used
  to intersect the declaration with the three text defaults, so a table declaring only `xlsx`
  built nothing.
- The venue profile's whole-profile `max_words` fallback is gone (0.6.0). An abstract's limit is
  written once, under `abstract.max_words`, and `schemas/profile.json` is strict about it.

**Reports that changed what they say.** `gate-profile` stopped reporting section order on
`phdude manuscript submit` (0.6.0) — a gate that sees one section cannot tell a reordered
manuscript from an incomplete one, so it warned about sections that were merely absent.
`phdude profile check` reports order and is the only reporter of it.

**What did not change.** Every object schema is still `version: 1`, and every field added since
0.1.0 is optional or carries a default, so a document written by 0.1.0 still validates. No exit
code was renumbered or given a new meaning: 0.5.0 added `EXECUTION`, which shares exit 4 with
`TOOL_MISSING` because both mean PhDude did its part and the thing it called did not come back.
The `--json` error envelope — `{"error":{"code","message","hint","details"}}` — has been the same
since 0.1.0 and is now held there by `tests/contracts/cli-json-shape.test.js`.

### Added

- **The schema freeze.** Every one of the 29 schemas carries
  `"x-phdude": { "stability": "stable", "since": "0.x" }`, where `since` names the release its
  shape landed in. `tests/fixtures/schema-snapshot.json` records each schema's `$id`, its
  `required` sets, its enums, its `const`s, its `$ref`s and how it is closed;
  `tests/contracts/schema-stability.test.js` fails on any drift unless `x-phdude.since` moved with
  it, and refuses a `since` that moves while the shape stands still. Re-recording is deliberate
  (`UPDATE_SNAPSHOT=1`), never automatic.
- **The CLI contract, frozen by test.** `tests/contracts/cli-json-shape.test.js` raises each error
  code from the smallest real invocation and asserts the envelope and the exit code, twice — once
  against a literal and once against `EXIT_CODES` — so renumbering a code fails. A companion test
  asserts every code the CLI can exit with has a case.
- **`docs/versioning.md`.** SemVer for PhDude: the public surface, the explicit non-surface,
  schemas, workspace versions, ports, skills and packs, the deprecation policy, and the checklist
  a breaking change has to walk.
- **`docs/extension-api.md`.** The seven ports — `SearchProvider`, `DocumentParser`,
  `DocumentRenderer`, `AgentHost`, `AnalysisRunner`, `ResearchPack`, `ResearchSkill` — each with
  its signature, lifecycle, error codes, stability, `since`, and the contract-suite invocation.
  It is also explicit about the boundary: PhDude executes no JavaScript from outside the package,
  so five of the seven are extended in-tree and only packs and skills are installable by a
  workspace.
- **`examples/extensions/`.** A third-party search provider against a fictional API (with the
  retry, timeout and typed-error handling the port actually requires), a plain-text document
  parser, a `txt` renderer, and a field pack laid out as a real discovery root. Each is a
  standalone MIT ESM package that imports nothing from PhDude, and
  `tests/contracts/example-extensions.test.js` runs all four through the shipped contract suites.
- **`docs/skills-authoring.md` and `docs/packs-authoring.md`.** The SKILL.md convention, the
  `phdude:` contract, the permission model and what asking for more costs at each install path;
  and field, method and venue packs, detection, publication profiles and CSL licensing.
- **The OpenCode host.** `phdude init --agents opencode` writes the compact `AGENTS.md` index and
  `.opencode/command/phdude*.md`, one per shipped slash-command template, under the same
  `phdude-managed` marker every other host uses. `agentHostContract` covers it.
- **`docs/agents.md`.** Claude Code, Codex, OpenCode and Gemini CLI: what each one reads, the two
  shapes of `AGENTS.md`, the permission difference between them, and what is and is not
  smoke-tested.
- **Three cross-field example workspaces.** `examples/quantitative-social-science` (a two-wave
  household survey with a dataset, an analysis, a table, a figure and an open fact conflict),
  `examples/machine-learning` (a quantization benchmark with two contradicting preprints and both
  claims disputed) and `examples/qualitative-humanities` (an archival study with no statistics, a
  disputed pair and an open decision proposing a survivor). Each is generated by
  `scripts/make-examples.mjs`, and each has golden `status`, `next`, `gaps`, `health` and `ready`
  reports. A test asserts the core mentions none of them, nor any field pack name — the field
  agnosticism claim, checked rather than asserted.
- **`docs/examples.md`.** What each of the four examples is, how to read one, how to regenerate
  them, and why they are the field-agnosticism test.
- **`docs/migration.md`.** The workspace version model, what every step from 1 → 5 actually does
  to your files, what a migration promises a researcher, what to do when one goes wrong, and how
  to write the next one.
- **`docs/non-goals.md`.** PRD §119 for contributors: what PhDude will not become, the detector
  rule in full, and the difference between extending PhDude and loading code into it.
- **Community files.** `CONTRIBUTING.md` (dev setup, the rules the code follows, what a new
  command owes, what a frozen-surface change costs), `CODE_OF_CONDUCT.md` (Contributor Covenant
  2.1), `SECURITY.md` (private reporting through GitHub advisories, and what counts as a
  vulnerability in a local tool), issue forms for bugs and features, a pull-request checklist and
  a Dependabot configuration for npm and actions.
- **A release workflow.** `.github/workflows/release.yml` runs on a `v*` tag: it checks the tag
  against the manifest, tests, packs, uploads the tarball, cuts the release notes out of this
  file, and publishes with `npm publish --provenance --access public` when `NPM_TOKEN` is
  present — with a notice instead of a failure when it is not. `workflow_dispatch` with
  `dry_run: true` runs everything except publishing and creating the release.
- **`npm run validate`.** The schema and skill validation subset — object fixtures, the stability
  snapshot, the skill contracts and the pack contracts — as one fast command, run in CI ahead of
  the full suite.

### Changed

- **CI is harder.** The `test` job adds an advisory `npm audit --audit-level=high`, `npm run
  validate`, and a parity step that regenerates all four example workspaces and fails if the tree
  is dirty. A new `windows` job runs the unit and contract suites on `windows-latest` under Node
  22, which is where path handling lives; the tool-dependent suites stay on ubuntu.
- **`docs/cli.md` marks all 43 commands `Stability: stable`,** and states what that promises,
  with a paragraph under **Exit codes** freezing the error envelope.
- **`package.json` ships the documentation.** `files` gains `docs/versioning.md`,
  `docs/extension-api.md`, `docs/skills-authoring.md`, `docs/packs-authoring.md`,
  `docs/migration.md`, `docs/non-goals.md` and `docs/examples.md`; the manifest gains
  `publishConfig.access: public` and keywords.
- **`scripts/make-example.mjs` was split.** The field-agnostic mechanics — fixed clock, stubbed
  git and fetch, pinned execution runner, and the helpers that write sources, record searches,
  accept candidates, submit drafts and approve sections — moved to
  `scripts/lib/example-builder.mjs`. `generic-thesis` is now a profile consumed by
  `buildExample`, and the committed example regenerates byte-for-byte.
- **`listCommandFiles` moved to `src/adapters/agents/shared.js`,** so both command-writing hosts
  enumerate the same template directory, and `snapshotAgentHostFiles` now watches
  `.opencode/command` as well as `.claude/commands` — without which a refreshed OpenCode command
  would be reported as created rather than updated.
- **The README had its 1.0 pass:** a 90-second tour, an install path that is honest about npm, the
  optional-tools table, a documentation index, and the roadmap closed out.
- **`docs/extending.md`** opens with a table pointing at the eight reference pages, and its
  migration section defers the detail to `docs/migration.md`.

### Fixed

- **Two slash-command templates were never refreshed after an upgrade.** `commands/manuscript.md`
  and `commands/profile.md` carried an unquoted `: ` in their front-matter description, which made
  the block invalid YAML, so `isPhdudeManaged` returned false and `phdude init` refused to
  overwrite files it had written itself. A researcher who upgraded PhDude silently kept the old
  `/phdude-manuscript` and `/phdude-profile`. Both are quoted, and the surface test now requires
  every template's front matter to parse rather than merely to match a regular expression.

### Notes

- **Still three runtime dependencies** (`yaml`, `ajv`, `fflate`) and no new network path. The
  OpenCode host writes files; the example extensions ship no dependencies at all.
- **What "stable" means here.** Schemas may gain optional fields; commands may gain flags; ports
  may gain optional capabilities. A required field, an enum value, an exit code, the error
  envelope, a command's meaning or a port's required shape may not change before 2.0, and
  `docs/versioning.md` carries the deprecation policy for when one has to.
- **PhDude still has no AI-detector, "humanity" or AI score, and never will** (PRD §30c). The
  refusal is in the argument parser, before any command-specific parsing, and the rule is now
  stated on a page of its own as well as in the README, `docs/cli.md`, ADR 8 and the
  `academic-prose` skill.
- **Not on npm yet.** The package, the manifest and the workflow are ready; publishing waits on
  the `NPM_TOKEN` secret. Until then the README's install path is clone, `npm ci`, `npm link`, and
  the release job says so rather than failing.

## [0.7.0] — 2026-09-08

The Reviewer. Every release until now helped build the argument; this one argues back, and then
says whether the work can go out. Reviews are records rather than chat messages: an agent reads a
bounded context, writes findings that each name the ids they rest on, and hands them back through
the CLI as `REVIEW-` objects the researcher accepts, dismisses or resolves. The citation auditor
checks the prose against the registry and, when the policy allows it, each DOI against Crossref.
Research Health scores eight dimensions and prints the observations behind every number.
`phdude ready` composes all of it into one verdict with the command that fixes each blocking item.
See [ADR 11](docs/adr/0011-research-health-formulas.md).

### Added

- **`REVIEW-` objects and the review workflow.** `schemas/review.json` (`phdude.review` v1):
  `kind` (citation, methodology, reviewer2, reproducibility, custom), `target` (an object id,
  `manuscript:<section>` or `project`), `severity` (block, major, minor, note), `message`,
  `evidence` ids, optional `suggested_command`, `status` (open, accepted, dismissed, resolved),
  `by` and the `mode` the review ran under. The id is derived from kind, target and message, so
  re-running a review finds its own finding rather than filing a second one.
  `phdude review <kind> [--target …] [--budget …]` assembles a bounded review context into
  `.phdude/cache/review/<kind>/context.md` and prints the findings contract, recording nothing;
  `phdude review submit --file findings.json [--kind k]` validates the whole file — every
  problem at once, located by index — and writes the objects with one `review` event;
  `review list|show|accept|dismiss|resolve` carry the verdict, which is the researcher's.
  `phdude next` gains a `reviews-open` rule, `high` while anything serious is open.
- **Three reviewer skills.** `skills/methodologist` (design-question fit, sampling, instruments,
  validity threats, reporting standards), `skills/reviewer2` (unsupported claims, overclaiming,
  missing alternatives, weak comparisons, contradictions ignored — every finding cites ids), and
  `skills/reproducibility-reviewer` (`repro check`, the analysis contracts, data availability),
  each with `references/` checklists. The medicine pack gains CONSORT, STROBE and PRISMA
  summaries.
- **`phdude audit citations [--allow-network] [--json]`.** Offline: every `[@key]` in every
  section resolves, every claim the prose asserts rests on a recorded source, no cited source is
  still an unreviewed or dismissed candidate, plus every `cite check` finding weighted into a
  severity. Online, through the v0.3 network policy: each DOI against Crossref `works/<DOI>` —
  unresolved, a title below 0.8 normalized-token Jaccard similarity, a year more than one out, and
  a retraction, which blocks. Findings land as `citation` reviews with one `audit` event; a
  lookup Crossref does not answer is a warning rather than a finding on file.
- **`phdude health [--save] [--trend] [--json]`.** Eight deterministic dimensions — literature
  coverage, evidence strength, methodological integrity, citation quality, freshness,
  reproducibility, consistency and academic prose quality — each 0-100 with the observations and
  ids behind it, weighted into an overall by `health.weights` in the research policy. A dimension
  the workspace cannot answer for is `null`, never a free 100. `--save` writes `reports/health.yaml`
  and records one `health` event; `--trend` reports what moved. It is never a detector or
  "humanity" score, and refuses any flag that names one (PRD §30c).
- **`phdude ready [--profile <venue>] [--json]`.** The submission verdict: the venue profile's
  blocking findings, Research Health against `ready.min_health`, each requirement in
  `ready.require` (`no-open-conflicts`, `no-disputed-pairs`, `no-block-reviews`,
  `all-sections-approved`, `figures-alt`, `repro-clean`, `citations-clean`) and the high-severity
  gaps no requirement already covers. Every blocking item carries the command that fixes it, and
  what passed is printed too. Exit 0 ready, 2 not. It never writes and records no event, and it
  never runs the citation auditor — it reads the recorded `citation` reviews and the read-only
  offline `cite check`.
- **`phdude skills list|install <path|https url>|remove <name> [--allow-network] [--force]`.**
  Installing copies a skill directory in — files only, nothing in a skill is ever executed —
  validates its contract against the loader before a byte lands in the workspace, refuses one
  whose declared permissions the policy has not opened, and records `{name, source, hash,
  installed_at}` in `.phdude/skills-lock.yaml` (`schemas/skills-lock.json`, `phdude.skills-lock`
  v1) with one `skills` event. A git URL requires `--allow-network` and is cloned with
  `execFile('git', ['clone', '--depth', '1', …])`, https only, no credentials, `.git` excluded. A
  skill whose front-matter name or description matches detector evasion or humanizing is refused
  with POLICY. `phdude doctor` lists external skills with their source and warns when one has been
  edited since it was installed.
- **Review modes that change behaviour, not records.** `ruthless` promotes an open `major`
  finding to `block` where the verdict is computed, so `phdude ready` and `phdude next` both
  harden without a stored severity being rewritten; `lite` blocks only on `block`-severity items
  and lists the rest as set aside; `full` is the default and `off` still answers a verdict that
  was explicitly asked for.
- **Migration `0004-workspace-v5.mjs`.** Workspace version 5: the `reviews/` directory, and the
  `health.weights` and `ready.*` keys backfilled into an existing research policy. Idempotent, and
  it never overwrites a value the researcher chose.

### Changed

- `AGENTS.md` and `CLAUDE.md` now index externally installed skills alongside the shipped ones,
  marked `(external)`, and `phdude skills install|remove` rewrites both. A skill the agent's own
  index never names is a skill the agent will never load.
- Citation Quality no longer charges for an open `citation` review recorded at `note` severity.
  `phdude audit citations` files an uncited source as exactly that, and `cite check` calls the
  same thing informational, so charging it would have meant running the auditor cost a workspace
  points for finding nothing wrong.
- `phdude cite check` takes an optional pre-loaded snapshot, so `health` and `ready` resolve the
  citation findings without loading and re-hashing the workspace a second and third time.
- `src/domain/prose-lint.js` exports its aggregate as `aggregateScore`, which is how Academic
  Prose Quality re-derives a section's score from the stored sub-scores rather than inventing a
  second formula.
- `fetchWithPolicy` gained `allowStatus`, so the DOI lookup can read a 404 as an answer instead of
  an error.
- The detector-flag guard also refuses `--humanity`, `--humanity-score` and `--ai-score`.
- The agent hosts moved behind `src/adapters/agents/hosts.js`, so every command that has to
  refresh the agent files resolves them the same way from what `phdude init` recorded.
- The example workspace carries one open `methodology` review, so `next`, `health` and `ready`
  each have the v0.7 loop to report on; `tests/golden/expected/ready.txt` is new.

### Notes

- Still three runtime dependencies (`yaml`, `ajv`, `fflate`). The only new network path is the
  Crossref DOI lookup, and it runs only under the v0.3 policy — `network.enabled: true` or
  `--allow-network` — plus `git clone` for a skill URL, through `execFile` with an argument array
  and never a shell.
- PhDude still has no AI-detector, "humanity" or AI score, and never will (PRD §30c). `health`
  refuses `--detector` like every other command, external skill installation refuses a
  detector-evasion purpose, and the rule is stated in the README, `docs/cli.md`, ADR 8 and the
  `academic-prose` skill.
- `ready` is a verdict, not a gate you cannot open: which checks run and how high the health bar
  sits are yours, in `ready.require` and `ready.min_health`.
- Reviews are not knowledge. A `REVIEW-` object has no knowledge state, is not in the lineage
  graph, and never becomes canonical; it is what a reviewer said and what you decided about it.

## [0.6.0] — 2026-09-08

The Document Factory. Until now a manuscript was a set of Markdown files and a YAML plan; now it
comes out the other end as the file somebody asked for — DOCX, PDF, LaTeX, HTML or Markdown —
built from the approved sections against the venue the work is going to, with the bibliography
regenerated from the citation registry. Two builds with nothing between them produce nothing the
second time, and two builds of the same inputs produce the same bytes. External tools are
optional adapters throughout: Markdown is built in, everything else says what to install. See
[ADR 10](docs/adr/0010-renderer-adapters-and-reproducible-builds.md).

### Added

- **The `DocumentRenderer` port and three adapters.** `available() → {ok, version?, hint?}` and
  `render({input: {markdownPath, bibPath?, cslPath?, referenceDoc?, template?, metadata},
  output: {path, format}, cwd}) → {path, warnings}`, with a contract suite that runs against every
  adapter. `render/markdown.js` is built in and always available: it writes the front matter and
  resolves `[@key]` into a plain author-year reference list from the citation registry.
  `render/pandoc.js` covers docx, pptx, html, latex and md with `--citeproc`, `--csl`,
  `--reference-doc` and `--template`; `render/latex.js` covers pdf through `latexmk -pdf`, falling
  back to `pdflatex` twice plus `bibtex` when the run needs it. `execFile` with argument arrays
  only, never a shell. `phdude doctor` reports each renderer and its version.
- **Venue packs.** `generic-thesis`, `ieee` and `acm` ship under `packs/venues/<name>/`: a
  `profile.yaml` (`schema: phdude.profile` v1) with the sections the venue expects and their word
  limits, its CSL citation style vendored with its CC BY-SA 3.0 notice intact, and a minimal
  pandoc LaTeX template for its document class. A workspace adds its own under
  `.phdude/packs/venues/<name>/`, and a workspace venue overrides a shipped one of the same name.
  `phdude packs apply <venue>` records it in `phdude.yaml`'s new `venues` list; a venue pack that
  ships no profile is refused rather than recorded.
- **`phdude profile list|show|check|use <venue>`.** `check` reports the manuscript against the
  venue: a required section that is missing, a section or abstract over its word limit, two
  sections the venue orders the other way round, a figure in a format the venue does not take, the
  reference style in force. Findings carry a severity and `check` exits 2 while anything blocks.
  `use <venue>` sets `manuscript.yaml`'s `target_profile` and records one `profile` event.
  Word counts strip Markdown, citations and evidence markers first, exactly as `gate-profile` does,
  so a section the gate lets through is one `profile check` lets through.
- **`phdude build [--format md|docx|pdf|latex|html] [--profile <venue>] [--sections a,b]
  [--include-drafts] [--force]`.** Assembles the approved sections in the venue's order, under the
  venue's headings, with `references.bib` regenerated through `cite export`, the figures the prose
  shows copied in beside the document (SVG converted to PDF with `rsvg-convert` when the venue asks
  for it and the tool is there, a warning naming the file when it is not), and a table linked on a
  line of its own spliced in from `tables/out/`. Everything lands in `outputs/<slug>/`.
- **Builds that skip themselves, and produce the same bytes twice.** Every input is hashed into
  `.phdude/cache/build/<slug>/<format>.json`: each section body, the bibliography, each figure and
  table, the venue profile, the CSL, the template and the renderer's own name and version. A build
  whose inputs all match, and whose output file still holds the bytes the record claims, reports
  `up to date`, renders nothing and appends no event; `--force` builds anyway, and `--json`'s
  `changed` names what moved. A build never reads the clock — the date comes from
  `manuscript.yaml`'s `date` or from the last approval the workspace recorded — so identical inputs
  and an identical Pandoc give identical Markdown, LaTeX and HTML. DOCX and PDF are containers with
  timestamps inside and are best-effort.
- **`phdude present outline [--from manuscript|claims] [--profile <venue>] [--force]`.** One slide
  per approved section, or per claim the evidence supports with its strongest excerpts as bullets,
  written to `outputs/<slug>/outline.md` and to `outline.pptx` when Pandoc is installed, through a
  registered PPTX template when one is bound.
- **XLSX and DOCX tables.** `phdude table build --format xlsx` writes a real spreadsheet through a
  built-in minimal SpreadsheetML writer (`fflate`, shared strings, a fixed timestamp so the bytes
  are deterministic, numbers typed as numbers) with no external tool at all; `--format docx` goes
  through Pandoc. Both are opt-in: a table that declares neither still builds md, latex and csv.
- **A templates registry.** `templates/` in the workspace and `.phdude/templates.yaml`
  (`schema: phdude.templates` v1). `phdude template add <path> [--kind docx|pptx|latex]` files a
  copy by kind and records its hash, `template use <name> --for <venue>` binds it to a venue,
  `template list` shows the registry, and `template check <name>` unzips a DOCX to report whether
  it declares the styles Pandoc writes with (Heading 1–3, Body Text, Caption), exiting 2 when it
  does not. A registered template outranks the one the venue pack ships.
- **`phdude adapt --to <venue> [--apply]`.** What moving the manuscript to another venue would
  take, computed before anything changes: the section mapping (by id, then by a `synonyms` entry the
  target venue declares, then by a shared title; anything left is `needs decision`), the word-limit
  delta per section, the abstract against the venue's limit, the figures whose format the venue does
  not take, the terminology the venue renames with the hits actually in the prose, and the citation
  style that takes over. `--apply` writes `manuscript/manuscript.<venue>.yaml`, whose sections point
  at the same `.md` files under the venue's ids, titles and order, marking anything over a limit
  `revised` and dropping its `approved_by`. It records one `adapt` event, never touches
  `manuscript/manuscript.yaml`, and never rewrites a line of prose — that goes back through
  `phdude deslop` and the same gates as every other revision.
- **Two agent skills, `build` and `venue-adapt`**, plus a `phdude build` walkthrough in the README
  ("Building documents"), the renderer port and venue-pack authoring in `docs/extending.md`, and a
  new `write` rule for how prose reaches a built figure or table.
- **Migration 0003 → workspace version 4:** an empty `venues` list in `phdude.yaml` and an empty
  template registry at `.phdude/templates.yaml`. Idempotent, and what it writes is what a fresh
  `phdude init` writes.

### Changed

- `phdude table build` with no `--format` now builds every format the table declares, rather than
  intersecting the declaration with the three text defaults — a table declaring only `xlsx` used to
  build nothing.
- `gate-profile` no longer reports section order on `manuscript submit`. A gate that sees one
  section cannot tell a reordered manuscript from one that is missing a section, which made it warn
  about sections that were merely absent. `phdude profile check` reports order, comparing the
  relative order of the sections the manuscript and the venue both have, and it is now the only
  reporter.
- The venue profile's whole-profile `max_words` fallback is gone; `schemas/profile.json` is strict
  and the abstract's limit is written once, under `abstract.max_words`, which the abstract section
  inherits.
- `phdude doctor` grows a `Renderers:` block, which means one warning line per renderer this
  machine cannot run.
- `phdude cite export` gained an optional path and now returns the text it wrote, so `build` can
  hash the bibliography before deciding whether to render.
- `src/domain/bibtex.js` gained `parseBibtex`, deliberately lenient: it recovers the fields a
  renderer needs and skips what it cannot read. It is not a general BibTeX parser.
- CI installs Pandoc, so DOCX, HTML, LaTeX and PPTX renders are exercised there. No TeX
  distribution: the PDF paths are asserted through their `TOOL_MISSING` branch rather than skipped
  silently.

### Notes

- Still three runtime dependencies (`yaml`, `ajv`, `fflate`) and still no network anywhere outside
  `phdude research`. Pandoc, a TeX engine and `rsvg-convert` are optional, probed with `execFile`,
  and never assumed present.
- Everything under `outputs/` is derived: gitignored, never read back as knowledge, rebuilt from the
  manuscript, the citation registry and the venue profile. The Markdown a build hands the renderer
  lives in `.phdude/cache/build/` instead, so nothing a build delivers is scratch.
- `build` does not enforce the venue. It renders what the manuscript is; the word limits and
  required sections are `phdude profile check`'s report, and the full readiness verdict is v0.7's.
- `build` does not read `manuscript/manuscript.<venue>.yaml` either. It reads the canonical
  manuscript and takes its venue from `--profile` or `target_profile`, so building for a venue
  applies that venue's order, headings, citation style and template to the canonical section list.
  The adapted file is the record of the mapping and the work list it implies.
- The PDF path and the shipped LaTeX templates have no compile coverage in CI, because installing a
  TeX distribution costs more than the release is willing to spend on every push.

## [0.5.0] — 2026-09-07

Analysis & Visualization. A number in a thesis now has a chain behind it that anyone can follow:
the file it came from and the bytes that file had, the script that read it, the run that produced
it, and the table and figure drawn from it. PhDude still does no statistics — the script is the
researcher's — but it runs that script under an explicit policy and remembers exactly what went
in and what came out. `phdude repro check` answers the question the whole release exists for:
does any of this still hold? See
[ADR 9](docs/adr/0009-execution-policy-and-results-contract.md).

### Added

- **An execution policy, closed by default.** `.phdude/research-policy.yaml` gains
  `execution: {enabled: false, runtimes: {node, python3, Rscript}, timeout_seconds: 600}`. No
  script runs without `execution.enabled: true` or `--allow-exec`, and the refusal names the
  setting that would open it. `phdude doctor` reports the policy and the runtimes it resolves.
- **The `AnalysisRunner` port and its local adapter.** `spawn` with an argument array, never a
  shell; the workspace as the working directory; an environment holding `PATH`, `HOME`, `LANG`,
  `PHDUDE_WORKSPACE` and one of `PHDUDE_ANALYSIS`/`PHDUDE_FIGURE`. A run is bounded by its
  process group, so a script that traps `SIGTERM` or leaves a child behind still dies at the
  timeout. A contract suite comes with the port.
- **Datasets.** `phdude data add <path> [--json '{description, license, sensitive}']`,
  `data list|show <id>|profile <id>`. A file under `data/` is hashed and its bytes are its
  identity (`DATASET-<hash10>`), so re-adding the same file is a no-op and editing it makes a
  new dataset linked to the old one through `versions_of`. The profile is deterministic: rows,
  per-column inferred type, missing cells, distinct values capped at 50, up to five samples —
  and `sensitive: true` drops the samples while keeping the counts.
- **Analyses and results.** `phdude analyze add --json`, `analyze list|show <id>|runs <id>`,
  `analyze run <id> [--allow-exec] [--force]`. An analysis declares a script under `analysis/`,
  the datasets it reads, and where it leaves `results.json`. A run records `at`, `exit`,
  `duration_ms`, the hash of every input and every output, and the results it wrote — plus
  `stderr_tail` (the last 2000 characters), `timed_out` and `signal` when they apply; a run whose
  inputs have not changed since the last successful one is refused as "up to date", and a run
  whose input file no longer matches its `DATASET` record is refused outright. Each entry
  in `results.json` becomes a citable `RESULT` with `from` pointing at the analysis. A re-run
  that reports a key under a **different summary** marks the old result `rejected` with
  `superseded_by` pointing at the new one; a re-run that reports **new values under the same
  summary** corrects that record in place, because the id is derived from the summary and the
  analysis and a record cannot supersede itself.
- **Tables.** `phdude table add --json`, `table list|show <id>|build <id> [--format md,latex,csv]`.
  A table renders a `RESULT`'s values or a `DATASET`'s columns as Markdown, LaTeX (`booktabs`,
  with a caption and a label) and CSV under `tables/out/`, deterministically and with LaTeX
  specials escaped. A build whose source has not moved and whose files already hold these bytes
  writes nothing.
- **Figures, with alt text that is not optional.** `phdude figure add --json`,
  `figure list|show <id>|build <id> [--allow-exec] [--force]|check`. `alt` is required and
  non-empty: a figure without a sentence saying what it shows never becomes a record. `build`
  runs the generator through the runner, verifies every declared output exists, and hashes it; a
  generator that exits 0 without writing what it declared is treated as a failure. A build whose
  inputs, generator script and output files are all what the last successful run recorded reports
  `up to date` and spawns nothing; `--force` builds anyway. `check` reports the figure rows of
  `repro check`, from the same computation, so the two commands never disagree about a figure.
- **A reference generator.** `generators/bar-chart.mjs` — plain Node, no dependencies — draws an
  accessible SVG with a title, a description carrying the alt text, real axis labels, one
  colourblind-safe hue and no timestamp, from a result's values or a dataset column. A figure
  names it as `phdude:bar-chart` and never as a path, so no workspace records where PhDude is
  installed.
- **`phdude repro check [--json]`.** One line per analysis, table and figure:
  `up-to-date | stale | never-run | missing-output`, each with the reasons behind it. It
  distinguishes an input that moved since the run that read it from a file whose bytes no longer
  match the `DATASET` record registered against them, because the fixes differ, and it carries a
  stale or never-run analysis into the table and the figure drawn from its results — so editing
  the data marks all three in one report. It runs nothing, writes nothing, and always exits 0.
- **The reports read it too.** `phdude status` gains an `Analysis:` block (datasets, analyses,
  results, tables, figures, and how many are stale or unbuilt). `phdude next` gains
  `analysis-stale` — high once a supported or canonical claim rests on one of that analysis's
  results, medium otherwise — plus `figure-missing-alt` and `never-run`. `phdude gaps` gains
  `result-uncited`.
- **Two skills and a section in the method packs.** `skills/analysis` and `skills/figures`
  (dataviz rules, alt text, one message per figure). Both declare
  `permissions.execution: allowed`, because both drive a command that spawns something, so both
  are installed only when `skills.allow_execution: true`. The `quantitative` and `qualitative`
  packs gain an "Analysis" section: which scripts a paradigm typically runs, and what a result
  from it owes a reader.
- **Workspace version 3**, with migration `0002-workspace-v3`: it adds the `execution` and
  `skills.allow_execution` policy keys when they are missing, creates `knowledge/datasets/`,
  `analysis/out/`, `tables/out/` and `figures/out/`, and appends the matching `.gitignore` rules.
  It never invents a policy file or a `.gitignore` that was not there, and never rewrites an
  existing `RESULT` id.
- **The example is now a finished workspace.** `examples/generic-thesis` carries
  `data/survey.csv`, the Node analysis script that reads it, two results, a table in three
  formats and a bar chart with alt text — and `phdude repro check` on it reports nothing to do.

### Changed

- `EXIT_CODES` gains `EXECUTION`, which shares exit code 4 with `TOOL_MISSING`: both mean PhDude
  did its part and the thing it called did not come back.
- The skill contract's `permissions` accepts an optional `execution: none|allowed`. Skills
  written before v0.5 stay valid and default to `none`.
- `RESULT` ids now include the analysis they came from, so two analyses can reach the same
  finding and each keep its own record. `from` joins the id material only when it names an
  analysis: v0.4 allowed prose there (`"logistic regression on survey sample"`), and every such
  result keeps the id computed from its summary alone, so re-adding one after `phdude migrate`
  finds the record already on disk rather than minting a duplicate. Migration 0002 rewrites no
  ids at all.
- `phdude edit` treats a result's `from` as an identity field, alongside `summary`. It was
  editable in v0.4, when it was not part of the id; changing it now would leave the record
  wearing an id that no longer describes it.
- `analysis/out/`, `tables/out/` and `figures/out/` are gitignored in a new workspace, and
  migration 0002 appends those rules to an existing `.gitignore` that has one.
- **Symlink confinement.** Every path a record hands PhDude to run, read or hash is resolved
  against the real workspace, not only checked as a string: a dataset, an analysis script, a
  results file, a declared output file and a figure generator or output are each refused (exit 1)
  when the link behind them leaves the workspace. Analyses and figures are checked at declaration
  *and* again after the script has run, because a link planted mid-run would otherwise be the one
  PhDude reads.
- **A run a signal ended is a failure, never a quiet success.** `RunResult` carries `signal`
  alongside `timedOut`, and `exit: null` with no timeout is named as what it is — `the analysis
  script was killed by SIGKILL`, `the generator was killed by SIGKILL building <figure>` —
  rather than read as a run that returned nothing. Both records keep `signal` and `timed_out`.

### Notes

- Node remains the only runtime the test suite requires; the runner's contract suite skips
  `python3` and `Rscript` honestly when they are not installed.
- `phdude analyze run` compares the `DATASET` records an analysis names, not the files under
  them, so a file edited without `phdude data add` is a refusal (exit 2, nothing recorded)
  rather than a run: writing down the registered hash for bytes the script did not read would
  make the lineage false. `phdude next` prints the whole sequence that clears it — register the
  file, re-declare the analysis against the new `DATASET` id, re-run.

## [0.4.0] — 2026-09-07

The Co-Author. PhDude does not write prose — the agent still does that — but a draft now has to
get past the workspace before it becomes a section of the manuscript. Six deterministic gates run
on every submit, a blocking finding writes nothing at all, and a section reaches `approved` only
through a Decision a researcher approved by name. **Nothing here computes, accepts or optimizes
for an AI-detector score, and nothing ever will** (PRD §30c). See
[ADR 8](docs/adr/0008-writing-pipeline-and-no-detector-rule.md).

### Added

- **The manuscript model.** `phdude manuscript init|list|show <s>|status|submit <s> --file f
  [--revision] [--allow-additions]|approve <s> --decision DEC-id|reopen <s>` writes
  `manuscript/manuscript.yaml` (`phdude.manuscript` v1) with the six standard sections as
  `planned`, and moves each one `planned → draft → revised → approved`. A section file carries a
  four-key front matter and the sha256 of its body with line endings normalized and trailing
  whitespace dropped, so reformatting a file does not read as a rewrite.
- **The recorded hash is checked.** `manuscript show`, `phdude prose <section>` and
  `phdude doctor` compare the hash in `manuscript.yaml` with the body on disk and say plainly
  when they differ: `section introduction was edited outside PhDude since its last submit`. Only
  a submit moves the recorded hash, so a hand-edit stays visible until the text goes back through
  the gates.
- **`phdude doctor` sees the manuscript.** A `Manuscript:` block reports the sections by status,
  the sections that have a report on file, and the drifted ones, with a warning for each.
- **Six writing gates**, each returning findings located to a line. `gate-citations`: every
  `[@key]` resolves to a recorded source, and a dismissed candidate may not be cited.
  `gate-evidence`: every marker names something real, a `rejected` claim may not be asserted, a
  verb may not outrun the claim's state or its evidence strength, and an unmarked numeral of two
  or more digits warns. `gate-prose`: nine rules over the text, reporting in `full` mode and
  blocking in `ruthless`. `gate-voice`: the draft's statistics against the active profile.
  `gate-meaning`: on a revision only. `gate-profile`: the venue's sections and word limits.
- **Meaning preservation.** `gate-meaning` extracts three multisets from the old and the new text
  — claim ids, citation keys, numerals — and counts the negations each carries, and blocks a
  revision that dropped any of them. A count rather than the cues themselves, so a negated
  sentence can be reworded, "did not" can become "failed to", and neither can quietly lose the
  negation. An added claim or citation blocks too, unless `--allow-additions`.
- **A blocked submit writes nothing.** Not the section file, not the manuscript entry, not the
  cache report, not an event. The findings reach the researcher through the error with their line
  numbers, and exit code 2.
- **`phdude write <section> [--voice id] [--budget chars]`** assembles the writing context of
  PRD §70 into `.phdude/cache/writing/<section>/context.md`, in priority order and within a
  character budget: the section's purpose, the canonical project facts, its claims with state and
  strongest evidence, the citation keys that resolve, the writing policy, the voice profile, and
  the verb table for the states present. It prints what was left out for budget and the contract
  the draft must meet. It writes cache and records no event.
- **`phdude deslop <section> [--file f] [--allow-additions]`.** Without a file, the section's
  prose observations plus the revision contract: what to change, and the explicit list of what a
  rewrite may not touch. With a file, the revision through every gate, recorded as `revised` only
  when the meaning survived.
- **`phdude prose <section> | --file <path> [--lang c]`** — the Academic Prose Quality report of
  PRD §39.1: six sub-scores from documented formulas over counted observations, the aggregate as
  their weighted mean, and every observation with its line and what to do about it. With a section
  it reads the evidence graph, so Evidence Alignment and Epistemic Precision are real numbers, and
  it rewrites `manuscript/reports/<section>.yaml` whole — hash, timestamp, gate rows, scores and
  counts recomputed together, so no number is stamped with a hash that does not describe it. With
  `--file` it needs no workspace. It reports and never blocks; the exit code is always 0.
- **Author voice profiles.** `phdude authors list|show <id>|add --json|learn <id> --from <path…>
  [--approved]|consensus` writes `authors/<id>.yaml` (`phdude.author-profile` v1). `learn`
  computes descriptive statistics from approved samples — sentence-length mean and SD, opening
  diversity, paragraph density, transition rate, first-person rate, hedge rate, frequent
  terminology — as plain numbers and word lists a researcher can read and correct. Never an
  embedding. `samples[]` holds one entry per path, and an approved sample stays approved.
  Relearning from unchanged samples rewrites nothing, `learned_at` included. `consensus` merges
  the profiles (median, union of `preserve`, intersection of `avoid`) into
  `authors/project-consensus.yaml` and proposes a Decision when the merge changed.
- **Human approval on sections.** `phdude manuscript approve <s> --decision DEC-id` requires a
  decision that is approved and lists `manuscript:<section>` in `affects`; anything less exits 3.
  An approved section is not overwritten — a later submit is refused until `manuscript reopen`,
  which records the withdrawal.
- **Text statistics and the prose lint core.** `src/domain/textstats.js` and
  `src/domain/prose-lint.js` are the single implementation of every rule; the `academic-prose`
  skill's `scripts/prose-lint.mjs` shells out to `phdude prose --file`, so the skill and the gate
  can never disagree. Language tables for `en` and `es`; an unknown language runs the structural
  rules only and says so as an `info` observation.
- **Two new skills**, `academic-prose` (the drafting and revision contract, with references on
  AI writing patterns, epistemic language, academic style, voice matching and worked examples,
  plus YAML fixture tests) and `write` (the drafting loop). `academic-prose` is the one skill in
  the repository that declares a write, `manuscript/**`, and even that goes through
  `phdude manuscript submit`.
- **Three schemas** — `manuscript.json`, `author-profile.json`, `section-report.json` — and one
  venue profile schema behind `packs/venues/generic-thesis/profile.yaml`.
- **Slash commands** `/phdude-manuscript`, `/phdude-write`, `/phdude-deslop`, `/phdude-prose` and
  `/phdude-authors`.

### Changed

- `phdude next` gains three rules: `sections-planned` (medium — a section is planned and its
  claims are supported or canonical), `draft-blocked` (high — the last submit had blocks) and
  `approval-pending` (medium — a revised section with no decision behind it).
- `phdude gaps` gains `claim-unwritten` (low — a canonical claim no section references).
- `schemas/decision.json` accepts `manuscript:<section-id>` as an `affects` entry alongside an
  object id. Decisions only; a section is not an entity, so it is checked against the
  manuscript's own section list rather than the id registry.
- `loadSnapshot` reads the manuscript, its section bodies and its reports, so `status`, `next`,
  `gaps` and `matrix` all reason about the same manuscript.
- The example workspace gains an author profile learned from one approved sample, a manuscript
  whose voice is that profile, and an introduction that went through the whole loop: submitted as
  a draft, revised once with its filler removed, reported on by `phdude prose`, and approved by a
  decision. `write-context.md` and `prose-introduction.txt` join the golden files.
- `phdude init` creates `manuscript/reports/`.

### Fixed

- **A decision affecting a manuscript section was reported as a dangling reference.**
  `manuscript:<section>` is a valid `affects` entry, but the lineage graph treated it as a
  missing entity, so every command that reads a snapshot printed
  `DEC-… references missing manuscript:introduction` as a warning. A section is not a node in
  that graph, and its absence from it is not a dangling reference.

### Notes

- **No AI-detector score, on any command.** The guard runs before command parsing and matches
  option names only: `--detector`, `--humanize-to` and `--ai-detection-score` exit 3 everywhere,
  including on commands that do not exist, while `--file notes-on-detection.md` and
  `phdude packs detect` keep working.
- Author Voice reports `n/a` until a voice profile is active for the section being scored, and
  the aggregate renormalizes over the sub-scores that could be computed. A sub-score with no
  input is `null`, never `0`.
- The workspace version is unchanged at 2. `manuscript/` and `authors/` have existed since v0.1
  and everything added is additive, so no migration is needed.
- Still no runtime dependency beyond `yaml`, `ajv` and `fflate`, and still nothing in the writing
  pipeline that reaches the network.

## [0.3.0] — 2026-09-07

The Research Engine. PhDude can go and find current literature for each research question, and
it does so under a policy the researcher owns. **The network is off until you turn it on**,
**nothing from your documents leaves the machine**, and **every provider call is recorded as an
event** carrying the provider, the query and a result count — never a result payload.

### Added

- **Literature search.** `phdude research "<query>" [--question RQ-n] [--provider a,b]
  [--from YYYY] [--limit N] [--allow-network]` queries the providers the workspace configured
  and records what came back. Nothing reaches a provider unless `.phdude/research-policy.yaml`
  sets `network.enabled: true` or the call carries `--allow-network`; otherwise it exits 3 with
  `network access is disabled`. A provider that fails is a warning and the run continues on
  what the others returned; only a run where every provider failed exits 4. See
  [ADR 7](docs/adr/0007-network-policy-and-search-providers.md).
- **Five search providers** behind one port (`src/ports/search-provider.js`): OpenAlex,
  Crossref, arXiv, Semantic Scholar and PubMed. Each maps its own response into one normalized
  candidate shape, treats the response as untrusted, and goes through a shared HTTP policy — a
  15 s timeout, exactly one retry on 429/503 with a backoff capped at 2 s, a `phdude/<version>`
  User-Agent, and typed errors naming the provider. `fetch` is injected, never imported, so no
  test can reach the network. `searchProviderContract` runs the same eight checks against any
  implementation, yours included.
- **Candidates.** `CAND-*` records in `knowledge/candidates/`, one per *work* rather than per
  provider hit: two providers returning the same paper — same DOI, or same normalized title and
  year — produce one candidate, with the extra providers in `providers[]`, their ids under
  `ext.ids`, and a field the first provider left empty filled by one that reported it. A
  candidate found again by a later run is reported as existing, never rewritten: the verdict a
  researcher gave it is not something a re-run may reset.
- **Recorded searches.** `SEARCH-*` records in `research/searches/` carry the query, the
  question, the providers, the filters that were applied and one entry per run, so a re-run can
  repeat a search exactly as it ran rather than as the policy reads today.
- **Candidate review.** `phdude research list|show` to read the queue, `phdude research accept
  CAND-… [--type t] [--approve-preprint]` to turn one into a `SRC-` with its identifiers,
  provenance and a note of where it came from, and `phdude research dismiss CAND-… --reason "…"`
  to record why one is not going in. A preprint needs `--approve-preprint` under
  `research.preprints.require_approval`. Accept invents nothing: a field no provider reported
  stays empty and `cite check` reports it afterwards.
- **Freshness.** `phdude freshness` reports the last search behind every research question, how
  many days ago it ran and whether the policy calls that stale, plus the age of every source and
  a summary. `phdude research-fresh [--question RQ-n] [--all]` re-runs the stale searches and
  reports **only new candidates** — a re-run that finds the same literature again is the answer
  "nothing has changed". Read-only `freshness` never touches the network.
- **`phdude edit <id> --json '<fields>'`** — the v0.2 backlog item. It corrects the non-identity
  fields of a non-canonical object in place and writes one `edit` event naming what changed. It
  refuses a `canonical` object (propose a Decision), an identity field (the id is derived from
  it, so record the correction with `phdude add`), and a field the schema does not know. `state`
  is not editable: that is `phdude promote`.
- **A new `research` skill**, the first with `permissions.network: allowed` and therefore the
  first installed only when the policy sets `skills.allow_network: true`. It covers writing a
  query from a research question, reading candidates with the researcher, and never accepting
  one whose abstract nobody read.
- **Slash commands** `/phdude-research`, `/phdude-research-fresh`, `/phdude-freshness` and
  `/phdude-edit`.

### Changed

- `phdude next` ranks thirteen rules rather than eleven: `stale-search` (medium — a question
  never searched, or whose newest search has aged past `research.freshness.stale_after_days`)
  and `candidates-pending` (medium, at five or more unreviewed candidates).
- `phdude gaps` reports two more kinds: `question-never-searched` and `stale-search` (low). Both
  read the network policy — with the network closed the command they print opens the policy
  first, and `question-never-searched` drops from medium to low, since a workspace that closed
  the network has decided where its literature comes from rather than overlooked it.
- `phdude status` gains a Literature block: candidates by state, searches recorded, and how many
  questions have a stale or missing search. Candidates and searches are counted there rather
  than in the knowledge counts — a candidate is not knowledge until it is accepted.
- `schemas/source.json` accepts `provenance`, which an accepted source carries.
- The example workspace records a search a year old and two candidates, one of them accepted, so
  the freshness and staleness rules have something honest to report; a `freshness` golden joins
  the five that were already there, and every calendar-reading golden runs against a fixed
  present.
- `phdude doctor` prints the network policy and the configured providers. It never calls out.

### Fixed

- **`phdude research-fresh` failed the whole run over one unrunnable search.** A stored search
  whose question is no longer on disk threw, discarding the results of every re-run already done
  in the same invocation. That record is now a warning (`skipped SEARCH-…: …`) and the rest
  still run.
- **A result's `from` could never be corrected.** It was refused as an identity field, but a
  result's id is derived from its `summary` alone. It is editable now.

### Notes

- Requires Node 22 or newer. `pdftotext` (poppler-utils) is still optional.
- A provider call carries the query, the `limit` and `from` filters, a `phdude/<version>`
  User-Agent, and nothing from the workspace's documents — no file, no excerpt, no filename.
- Two providers take an API key, both read from the environment and never from the workspace:
  Semantic Scholar takes `PHDUDE_S2_API_KEY` as an `x-api-key` header, and PubMed takes
  `PHDUDE_NCBI_API_KEY` as the `api_key` query parameter NCBI documents. Neither key reaches an
  error message or the event log; both providers answer at the anonymous rate limit without one.
- OpenAlex and Crossref receive the `email` from `.phdude/author-profile.yaml` as a polite
  `mailto` when the profile has one, and nothing when it does not.
- The workspace version is unchanged at 2: `knowledge/candidates/` and `research/searches/` are
  new directories, created lazily on the first write, so no migration is needed.

## [0.2.0] — 2026-09-07

The Research Brain. The workspace starts reasoning about the literature it holds. Still no
model anywhere in the runtime, and still no network call.

### Added

- **Citation registry.** `phdude cite list|check|export` derives a stable `bibkey` per source
  (or honours one the source declares), verifies the registry against six finding kinds, and
  exports BibTeX or CSL-JSON. It is derived, never canonical: the export records no event, and
  the citation is always the `SRC-` id. `uncited-source` is informational and never fails the
  check on its own.
- **Literature matrix.** `phdude matrix [--format md|csv] [--question RQ-n]` prints one row per
  source: the research questions and claims its evidence reaches, the strongest evidence citing
  it directly, the facts drawn from its artifacts, and any pack-declared method tags.
- **Research gaps.** `phdude gaps` reports ten kinds of gap grouped by severity, each with the
  reason it fired and a runnable command. The uncited-source condition carries the one name
  `uncited-source` in both `gaps` and `cite check`. `phdude next` gained a matching rule that recommends
  the report once one high-severity gap or three gaps of any severity exist, and its closing
  line reports the open gap count rather than claiming the workspace is consistent.
- **Claim contradictions.** `phdude link CLAIM-a --contradicts CLAIM-b` records that two claims
  cannot both be true. The relation is symmetric and moves both sides to `disputed` with no
  decision required — a `canonical` claim included, because surfacing a contradiction should not
  wait for approval. Resolving one needs an approved decision naming a `survivor`, with every
  losing claim rejected first. `phdude status` lists open disputed pairs. The two writes are not
  atomic, so a repeat of the same call heals an asymmetric pair rather than reporting a no-op.
- **Methods.** `phdude add method` records design, paradigm, sampling, instruments, analysis and
  limitations as a first-class object, and `phdude link METH-… --to RQ-n` attaches it to the
  questions it addresses.
- **Provenance.** Claims and evidence carry `provenance.method` (`manual`, `agent-extraction`
  or `imported`) and `provenance.derived_from`, the artifacts behind the record. `phdude
  knowledge trace` prints both.
- **Workspace versioning and migrations.** `phdude.yaml` carries `workspace_version`, and
  `phdude migrate [--dry-run] [--force]` upgrades an older workspace through migration modules
  shipped in `migrations/`. Migration `0001-workspace-v2.mjs` backfills `provenance` on claims
  and evidence and `contradicts` on claims, and stamps the workspace at version 2. Steps are
  idempotent, run through the `Store` port only, and append one `migrate` event each. See
  [ADR 6](docs/adr/0006-workspace-versioning-and-migrations.md).
- **Skill contracts.** Every `SKILL.md` declares a `phdude:` block — `reads`, `writes` and
  `permissions` — validated against `schemas/skill.json` on load. A skill with no block loads
  with a least-privilege default and a warning. A skill requesting network access is refused
  unless `.phdude/research-policy.yaml` sets `skills.allow_network: true`; `phdude doctor` lists
  every discoverable skill with its source and permissions.
- **A seventh core skill, `literature`**, covering the citation check, the matrix and the gap
  report.
- **Slash commands for every CLI command**, `init`, `promote`, `cite`, `matrix`, `gaps`,
  `migrate` and `help` included; `CLAUDE.md`'s list is now generated from the installed
  templates.

### Changed

- Reads on an out-of-date workspace keep working and warn `workspace needs migration (1 → 2)`;
  writes (`add`, `link`, `ingest`, `decide`, `promote`, `packs detect`, `packs apply`, `mode`)
  exit 1 with that message and the hint `run phdude migrate`.
- Sources accept `bibkey`, `abstract`, `keywords` and `identifiers { doi, isbn, arxiv, pmid,
  url }`; the top-level `doi` and `url` still work, with `identifiers.doi` taking precedence.
- `phdude doctor` reports the workspace version and whether it needs migrating, and lists every
  discoverable skill with its source and permissions. Being the command you run when something
  is already wrong, it degrades rather than fails: one unloadable skill costs one warning and
  the rest are still listed, and a skill whose network permission the policy has not allowed is
  warned about rather than refused. Because `init` copies the core skills into
  `.phdude/skills/`, a copy identical to the shipped file reports as `core` and only an edited
  one as `workspace`.
- `phdude status` and `phdude next` account for disputed pairs and provenance, and `next` ranks
  eleven rules rather than ten.
- The example workspace now exercises every gap kind — a contradiction left disputed, an
  untested hypothesis, a question whose only claim is a candidate, and a classified but unmined
  artifact — and the golden tests assert the full set.

### Fixed

- **An unrecognised flag was ignored.** `phdude knowledge list --stat candidate` returned the
  unfiltered list, which reads as an answer rather than a mistake. Every command now declares
  the options it takes, and anything else exits 1 naming the flag and listing what that command
  accepts.
- **`phdude ingest .` walked the whole workspace.** It now walks `sources/` only, and an
  explicit path into `knowledge/`, `research/`, `decisions/`, `.phdude/` and the rest exits 1
  with `not a source path` — re-importing the knowledge base as evidence for itself is not a
  thing anyone wants.
- **`phdude decide supersede` took the superseding decision in `--by`,** the same flag that
  records which researcher made the call. The replacing decision moved to `--with`, `--by` is
  the researcher on every subcommand, and the old form exits 1 with that correction.

### Notes

- **No id churn.** The id material for every object type is unchanged from 0.1.0, the evidence
  (`source`, `locator`, `excerpt`) and decision (`title`, `rationale`, sorted `affects`, stable
  `change`) materials that 0.1.0's own fix wave settled included. A 0.1.0 workspace keeps every
  id it has; `phdude migrate` adds fields, and renames nothing.
- Requires Node 22 or newer. `pdftotext` (poppler-utils) is still optional.

## [0.1.0] — 2026-09-07

First release: the deterministic harness. No model is involved in anything below.

### Added

- **The workspace.** `phdude init` creates a plain git repository of YAML and Markdown —
  project config, seven policy files, the knowledge and research directories, decisions, and
  the append-only event log — and is safe to re-run.
- **Ingestion.** `phdude ingest` walks `sources/`, hashes every file, detects its kind,
  extracts text, sections and tables into a disposable cache, and records one artifact per
  distinct file hash. Parsers for PDF (via `pdftotext`), DOCX, PPTX, XLSX, CSV, Markdown and
  plain text; extraction degrades to a warning rather than failing.
- **The knowledge graph.** Artifacts, sources, claims, evidence, facts, results, research
  questions, hypotheses and decisions, one schema-validated file each, with content-derived
  ids so re-running an extraction duplicates nothing.
- **Conflict detection.** Facts that share a key but disagree across artifacts are reported
  by `phdude status`, and stay open until an approved decision covers every fact in the group.
- **Human authority.** `phdude decide propose|approve|reject|supersede` and
  `phdude promote <id> --decision <DEC-id>`: an object reaches `canonical` only through an
  approved decision that names it, and approvals are recorded against a named researcher.
- **Next-action scoring.** `phdude next` ranks ten rules by impact, then by how many objects
  depend on the action, and always prints the reasoning and the exact command to run.
- **Querying.** `phdude knowledge list|show|trace` filters the graph and walks lineage in
  both directions.
- **Editing what exists.** `phdude link <id> --to <id>…` attaches evidence and questions to a
  claim, questions to a hypothesis and artifacts to a source.
- **Packs.** Field and method packs (`business`, `computer-science`, `humanities`,
  `medicine`, `qualitative`, `quantitative`, `systematic-review`) with keyword detection that
  recommends but never applies itself. Workspaces may add their own.
- **Agent adapters.** Claude Code (skills, `AGENTS.md`, `CLAUDE.md` and twelve slash commands)
  and Codex (inline `AGENTS.md`), both refusing to overwrite a file you have taken ownership
  of.
- **Six agent skills** — core discipline, bootstrap, knowledge, decisions, next and review
  modes — installed into the workspace and refreshed by `init`.
- **`phdude bootstrap`** for a messy existing project, and `phdude doctor` for adapters,
  cache, schema versions and git state.
- **Typed errors** carrying a code, a message and an actionable hint, with exit codes 0 ok,
  1 usage, 2 validation, 3 policy, 4 external tool missing, honoured under `--json` too.

### Notes

- Requires Node 22 or newer. `pdftotext` (poppler-utils) is optional.
- No network access and no shell interpolation anywhere in the runtime.

[1.0.0]: https://github.com/LucioY250/phdude/compare/v0.7.0...v1.0.0
[0.7.0]: https://github.com/LucioY250/phdude/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/LucioY250/phdude/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/LucioY250/phdude/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/LucioY250/phdude/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/LucioY250/phdude/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/LucioY250/phdude/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/LucioY250/phdude/releases/tag/v0.1.0

# Extending PhDude

PhDude keeps four things apart, and where your extension goes depends on which one it is:

```
CORE     = what PhDude knows and remembers.
SKILLS   = what PhDude knows how to do.
PACKS    = how PhDude adapts to a field, method or venue.
ADAPTERS = how PhDude interacts with an agent or external system.
```

A capability that needs no memory, no provenance and no approval gate is a Skill. Anything
that must still be true tomorrow, for another researcher on another agent, belongs in Core.

## Packs

A pack is a directory holding `pack.yaml` and, for a field or method pack, its own skill
Markdown. It carries vocabulary and recommendations, never executable code. Built-in packs live
under `packs/fields/`, `packs/methods/` and `packs/venues/`; a workspace can add its own under
`.phdude/packs/<kind>/<name>/`, and a workspace pack with the same name overrides the built-in
one.

```yaml
schema: phdude.pack
version: 1
name: quantitative
kind: method                # field | method | venue
description: >-
  Quantitative research methods: statistical hypothesis testing, surveys, and
  experimental design.
terminology:                # vocabulary the agent should prefer in this discipline
  - p-value
  - effect size
detect:
  keywords:                 # scored against cached text by `phdude packs detect`
    - regression
    - p-value
    - anova
reviewers:                  # reviewer perspectives this discipline expects
  - statistical-validity
recommended_checks:
  - power-analysis
  - assumption-checks
skills:                     # paths relative to the pack directory
  - skills/quantitative/SKILL.md
schemas: []                 # optional extra JSON Schemas for ext.<pack> fields
```

Rules the loader enforces:

- `pack.yaml` must validate against `schemas/pack.json`; every listed key is required.
- `name` matches `^[a-z0-9-]+$` and is unique per discovery root.
- Every path in `skills` must exist and must resolve inside the pack directory. Absolute
  paths, `..` traversal, paths containing a NUL byte, and symlinks pointing outside the pack
  directory are all rejected with a validation error.
- Core schemas stay untouched. A pack may only add fields under `ext.<pack>`.

Run the shipped contract suite over your pack by putting it under `packs/` and running:

```
node --test "tests/contracts/packs.test.js"
```

It validates every discovered pack and checks that each referenced skill file exists.

### Venue packs

A venue pack is the publication profile of one venue: the sections it expects, the limits it
sets, the citation style it wants, and a minimal LaTeX template for its document class. Three
ship with PhDude - `generic-thesis`, `ieee` and `acm` - and each is a directory under
`packs/venues/<name>/`:

```
packs/venues/ieee/
├── pack.yaml                  # kind: venue, no detection keywords, no skills
├── profile.yaml               # schema phdude.profile v1
├── csl/ieee.csl               # the citation style, vendored
└── templates/IEEEtran.tex     # a minimal pandoc LaTeX template
```

```yaml
schema: phdude.profile
version: 1
name: ieee                    # the directory it lives in
display: IEEE conference paper
description: >-
  The IEEE conference template.
document_class: IEEEtran      # what the LaTeX template declares
citation_style: csl/ieee.csl  # a CSL file in the pack, or the name of a built-in style
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
    synonyms: [intro, background, related-work]   # what this venue would call the same section
abstract:
  max_words: 250              # the abstract section inherits this unless it sets max_words
page_limit: 8                 # reported, not enforced: pages are a rendering fact
figures:
  formats: [pdf, png]         # the formats the venue takes
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

Rules the loader enforces:

- `profile.yaml` must validate against `schemas/profile.json`; unknown keys are refused.
- `name` must equal the directory the profile lives in.
- `citation_style` ending in `.csl`, and every path under `templates`, must exist and must
  resolve inside the pack directory. Absolute paths, `..` traversal, paths containing a NUL
  byte and symlinks pointing outside the pack are rejected, exactly as a pack's skill paths are.
- A `citation_style` that is not a `.csl` path is taken as the name of a style the renderer
  already knows, and resolves to no file.

The loader looks in `packs/venues/<name>/` and then `.phdude/packs/venues/<name>/`, so a
workspace venue overrides a shipped one of the same name. A venue directory holding only a
`profile.yaml` still loads and still appears in `phdude profile list`; give it a `pack.yaml`
with `kind: venue` if you also want `phdude packs apply <name>` to record it in `phdude.yaml`.

Venue packs declare `detect.keywords: []` and `skills: []`. A venue is a decision the researcher
makes about where the work is going, so `phdude packs detect` must not infer one from the corpus,
and a venue carries validation data rather than guidance.

`synonyms` is the one field only `phdude adapt` reads. It is the venue saying which other names
mean this section, so a manuscript with a `related-work` chapter can be told what that chapter
becomes at a venue that folds it into the introduction. Adapting maps a section by its id first,
then by a synonym the target venue declared, then by a title the two share; a section nothing
matches is reported as **needs decision** and left for the researcher. Synonyms never relax
`phdude profile check`: a section the venue does not list is still `section-unknown` there,
because the check reports the manuscript as it is and `adapt` is what proposes the move. A target
section can only be claimed once, so two manuscript sections that both look like one venue
section leave the second undecided, naming the first.

### What a profile is checked against

`src/domain/profiles.js` holds the rules, and both readers go through it: `gate-profile` runs
the per-section rules on every `manuscript submit`, and `phdude profile check` runs all of them
over the whole manuscript. A section the gate lets through is a section `profile check` lets
through, because neither has its own copy of the rule.

Order is the exception, and it is a rule about the manuscript rather than about a section: a gate
that sees one section cannot tell a reordered manuscript from one that is simply missing a
section. `checkProfile` compares the sections the manuscript and the venue both have, in
manuscript order, against the same set in venue order, so a missing section leaves no gap and a
section the venue does not list holds no place. `phdude profile check` is the only reporter.

| Finding | Severity | When |
|---|---|---|
| `section-missing` | block | the venue requires a section the manuscript does not have |
| `section-words` | block | a section's body is over its `max_words` |
| `section-unknown` | warn | the manuscript has a section the venue does not list |
| `section-order` | warn | two sections the venue orders one way sit the other way round; the finding names the pair and carries no `section` |
| `figure-format` | warn | a figure produces no format in `figures.formats` |
| `section-optional` | info | the venue also takes a section the manuscript does not have |
| `section-unwritten` | info | a required section has no prose to measure yet |
| `references-style` | info | the reference style in force |

Word counts come from `domain/textstats.js`'s `words`, which strips Markdown, `[@key]` citations
and `<!-- claim: -->` markers first, so a citation-dense paragraph is measured as the prose it is.

### CSL licensing

The `.csl` files under `packs/venues/*/csl/` come unmodified from the
[CSL styles repository](https://github.com/citation-style-language/styles) and keep their own
`<rights>` element: CC BY-SA 3.0, not the MIT licence the rest of PhDude uses. See
[packs/venues/README.md](../packs/venues/README.md). If you need a variant of a shipped style,
add it as a workspace venue pack rather than editing the vendored file.

## Writing gates

A gate is a pure function over the draft text and a context the application layer assembled:

```js
{
  name: 'gate-citations',
  run(text, ctx) {
    return [{ gate: 'gate-citations', severity: 'block', line: 12, message: '…', hint: '…' }];
  },
}
```

`severity` is `block`, `warn` or `info`. A gate may instead return `{ findings, scores }` when it
also measures something; only `gate-prose` does. Gates never reach the store: `gateContext` in
`src/application/manuscript.js` gathers the sources, claims, evidence, facts, results, bibkeys,
language, review mode and venue profile once and hands the same object to every gate. That is
what lets `submit`, `deslop` and `prose` give identical answers about the same text.

The registry is `GATES` in `src/domain/gates/index.js`. Adding one in-tree is an entry there plus
a fixture-driven unit test under `tests/unit/domain/gates/`. The runner reports gates in
registration order, so put a gate where its findings belong in the reading order: what the prose
rests on first, how it reads second, what a revision must not lose last.

**What a pack can extend today.** A venue profile, as above. Everything else a discipline brings
to writing reaches the agent as prose: a pack's `SKILL.md` carries the epistemic norms of its
field, and the `academic-prose` skill's `references/epistemic-language.md` carries the general
ones. The banned-phrase, transition and hedge inventories `gate-prose` uses are per-language
tables in `src/domain/lang/<code>.js`, and the verb table `gate-evidence` enforces is a built-in
table in `src/domain/gates/markers.js`. Neither is pack-extensible yet.

**What is planned.** PRD section 8 describes a `writing.epistemic_norms` list in `pack.yaml`, so
that a machine-learning pack can say "report results as observed on the evaluated benchmarks; do
not generalize beyond them" and have `gate-evidence` enforce it rather than merely suggest it.
`schemas/pack.json` sets `additionalProperties: false` and has no `writing` key, so a pack
carrying one fails validation today. Wiring it up is three changes that have to land together:
the schema key, a loader that merges every applied pack's norms into `gateContext`, and a rule in
`gate-evidence` that reads them. It is scheduled with venue adaptation in v0.6. Until then, put
your field's epistemic norms in the pack's skill, where the agent will read them.

## Skills

Skills follow the open Agent Skills convention: a directory with `SKILL.md` in YAML front
matter plus Markdown, and progressively loaded resources beside it.

```
skills/<name>/
├── SKILL.md
├── references/
├── scripts/
└── tests/
```

The front matter carries the standard `name` and `description`, and PhDude's research
contract under a `phdude:` key:

```yaml
---
name: bootstrap
description: Ingest a messy research workspace, classify its artifacts, and extract the first sources, facts, and candidate claims.
phdude:
  version: 1
  reads: [sources/**, .phdude/cache/**, knowledge/artifacts/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---
```

`writes` is empty for every shipped skill but one, because a skill never edits the workspace
directly: it runs `phdude add`, `phdude decide` and the other write commands, so the runtime
validates, hashes, attributes and logs each change. See
[ADR 4](adr/0004-agent-writes-through-cli.md). The exception is `academic-prose`, which declares
`writes: [manuscript/**]` (PRD §30b) — and even there the prose reaches the workspace through
`phdude manuscript submit`, never through a file edit.

Skills in `skills/` are copied into `.phdude/skills/` by `phdude init`. `tests/unit/skills.test.js`
checks that every shipped skill has valid front matter and declares the writes it is allowed
(none, or `academic-prose`'s `manuscript/**`);
`tests/contracts/skills.test.js` checks that every shipped skill (core and packs) loads and
validates against the skill contract schema below.

### Skill contract

The `phdude:` block is validated against `schemas/skill.json` (`$id: phdude://skill`). Only the
block itself is checked, not the rest of the front matter.

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `version` | yes | `1` | The only supported contract version. |
| `reads` | yes | `string[]` | Workspace globs the skill reads. |
| `writes` | yes | `string[]` | Workspace globs the skill writes directly. Empty for every core and pack skill but `academic-prose`, which declares `manuscript/**` (see above). |
| `permissions` | yes | object | `{ network: 'none'\|'allowed', execution?: 'none'\|'allowed', workspace: string[] }`. `workspace` is one or more of `read`, `write:manuscript`, `write:knowledge`, `write:sources`, at least one entry. `execution` is optional and defaults to `none`, so every skill written before v0.5 stays valid. |
| `objects` | no | `string[]` | Research object types the skill works with. |
| `artifacts` | no | `string[]` | Artifact kinds the skill produces. |
| `evidence_requirements` | no | `string` | Free text: what evidence the skill demands before writing. |
| `provenance` | no | `string` | Free text: how the skill records provenance. |
| `approval_gates` | no | `string[]` | Approval gates the skill's output must pass. |
| `quality_gates` | no | `string[]` | Quality gates the skill's output must pass. |
| `dependencies` | no | `string[]` | Other skills this one depends on. |
| `tests` | no | `string` | Path to the skill's own fixture tests. |

`additionalProperties: false` applies to the block and to `permissions`, so an unknown field is
a validation error, not a silently ignored typo.

**Least privilege by default.** A skill with no `phdude:` block still loads (the open Agent
Skills convention does not require one) but gets the default contract
`{ version: 1, reads: [], writes: [], permissions: { network: 'none', workspace: ['read'] } }`
plus a warning: `skill <name>: no phdude contract, least privilege assumed`. A skill whose block
is present but invalid fails to load with a `VALIDATION` error naming the offending fields.

**Network permission.** `.phdude/research-policy.yaml` carries `skills.allow_network` (default
`false`), and a skill that declares `permissions.network: allowed` needs it. The two commands
that install skills treat that differently. `phdude packs apply` refuses the whole pack with a
`POLICY` error, because adopting half a pack is not what anyone asked for. `phdude init`
*withholds* the skill and installs every other one, exiting 0 — a default workspace must still
initialize — and names the skill and the setting that would install it; re-running `init` after
setting `skills.allow_network: false` again removes a skill installed under the earlier
permission and reports it as `removed`. An invalid skill still stops both: nothing is copied or
applied when one skill in the batch fails to load.

**Execution permission.** The same shape, one setting along: `.phdude/research-policy.yaml`
carries `skills.allow_execution` (default `false`), and a skill that declares
`permissions.execution: allowed` needs it. Two shipped skills do: `skills/analysis`, which tells
an agent how to declare and run an analysis, and `skills/figures`, whose `phdude figure build`
spawns a generator. The two settings are independent — opening the network does not open
execution — and both gate *installation* only. Whether a script actually runs is
`execution.enabled` in the same file, checked at run time by `phdude analyze run` and
`phdude figure build`, so a workspace can hold both skills and still refuse every run.

**Discovery order.** `discoverSkills` (`src/adapters/skills/loader.js`) walks a list of roots in
order — the package's own `skills/`, each applied pack's skill directories, then
`<workspace>/.phdude/skills/` — and a later root's skill overrides an earlier one with the same
name. One unloadable skill aborts the whole discovery, which is what `init` and `packs apply`
need: neither may adopt half a set. `phdude doctor` passes an `onError` callback to opt out of
that, so a broken skill costs one warning instead of the entire report.

`phdude doctor` reports the resulting set with each skill's `source` (`core`, `pack:<name>`, or
`workspace`) and declared permissions. Because `init` copies the core skills into
`.phdude/skills/`, `source` compares the copy against the shipped bytes: identical is still
`core`, and only an edited copy is `workspace`. See [`phdude doctor`](cli.md#phdude-doctor).

### External skills

A skill that is neither PhDude's nor a pack's is installed with
[`phdude skills install`](cli.md#phdude-skills-listinstall-pathgit-url-removename), from a
directory on this machine or from an https repository. PhDude copies the files and records where
they came from; it never runs anything inside a skill, and a skill is not code PhDude executes.

```
phdude skills install ../lab-skills/prisma-screening
phdude skills install https://example.org/lab/prisma-screening.git --allow-network
phdude skills list
phdude skills remove prisma-screening
```

The tree is staged and validated outside the workspace before anything lands in
`.phdude/skills/`, so a refusal leaves nothing behind. Four rules decide whether a skill is
installed at all:

- **The contract.** The `phdude:` block validates against the schema above, or the install fails
  with a `VALIDATION` error naming the fields.
- **Purpose.** A skill whose front matter `name` or `description` matches
  `/detect(or|ion)\s+(evasion|bypass)|humaniz|humanity score/i` exits 3 with a `POLICY` error.
  PhDude has no detector score and will not install a skill that offers one (PRD §30c). The regex
  reads the purpose the skill declares about itself and not the whole file, so a skill that
  *states the prohibition* — as the shipped `academic-prose` skill does — stays installable.
- **Permissions.** The same gate a shipped skill goes through, applied before installation rather
  than after: a skill declaring `permissions.network: allowed` or `permissions.execution: allowed`
  that the research policy has not opened is refused with the setting that would install it,
  instead of being installed and then withheld.
- **Names.** A name PhDude ships is refused, because `phdude init` mirrors the shipped set into
  `.phdude/skills/` and would overwrite the copy. A name already installed is refused unless
  `--force` replaces it.

A symlink anywhere in the source directory is refused too: following it would copy bytes from
outside the directory the researcher named, exactly as a pack's skill paths may not resolve
outside the pack.

A git source is cloned with `execFile('git', [...])` — an argument array, never a shell — as a
shallow clone of one commit, and only over `https` without credentials; every other transport is
refused before git is called. The clone's `.git` is not copied.

Each install writes `{ name, source, hash, installed_at }` into `.phdude/skills-lock.yaml` and one
`skills` event; `remove` deletes the directory and its lock entry and writes one more. See
[the skills lock](workspace.md#the-skills-lock) for the hash and what `doctor` does with it.

## Adding a migration

A change to the shape of the workspace — a new required field, a renamed one, a file that moves
— is a migration step, not a read-time default. Steps live in the package's `migrations/`
directory, one module per step, named `NNNN-<slug>.mjs`:

```js
export default {
  from: 2,
  to: 3,
  describe() {
    return 'what this step does, in one line, for the CLI and the event log';
  },
  async preview(store) {
    return ['knowledge/claims/CLAIM-….yaml']; // paths this step would rewrite
  },
  async apply(store) {
    return { changed: ['knowledge/claims/CLAIM-….yaml'] };
  },
};
```

Four rules the runtime relies on:

- **`from` and `to` chain.** `src/application/migrate.js` discovers every step, orders them, and
  plans the run from the workspace's version to `CURRENT_WORKSPACE_VERSION` in
  `src/domain/versioning.js`. Bump that constant in the same change, or the step never runs.
- **`preview` and `apply` must agree.** Compute the change list once and use it for both, the
  way `0001-workspace-v2.mjs` does; `--dry-run` is only trustworthy if it reports what `apply`
  would actually touch.
- **Idempotent.** Re-applying a step changes nothing, so a half-finished run is fixed by running
  `phdude migrate` again rather than by hand.
- **Store only.** A step gets the `Store` port and nothing else — no `node:fs`, no network — so
  it cannot reach outside the workspace, and it is testable against a temporary directory.

Do not interpret content. A migration backfills what the old shape implies (`provenance.method`
is `imported` for records that predate the field, not a guess at who wrote them); anything that
needs judgement is a research decision and belongs to the researcher.

Cover the step in `tests/unit/application/migrate.test.js` and, if it rewrites entities, add a
workspace at the old version under `tests/fixtures/workspaces/`. See
[ADR 6](adr/0006-workspace-versioning-and-migrations.md) for why the workspace is versioned
rather than each object.

## Ports and contract suites

Adapters implement documented JavaScript interfaces in `src/ports/`, and each port ships a
contract suite that any implementation must pass. Register your adapter with the suite and
the tests come with it.

### DocumentParser

```js
{
  name: 'pdf',
  kinds: ['pdf'],
  available: async () => boolean,
  parse: async (buffer, { path }) => ({ text, sections, tables, meta, warnings }),
}
```

`sections` are `{title, text}`, `tables` are `{name, rows}` where `rows` is an array of
string arrays. Parsing must be pure and idempotent: the same buffer always yields the same
result, and an empty buffer must not throw. `available()` probes external tools; when it
returns false the artifact is still inventoried and hashed, and the extraction status
explains what is missing.

```js
import { documentParserContract } from '../../src/ports/document-parser.js';
documentParserContract(test, assert, myParser, [['sample.rtf', fx('sample.rtf')]]);
```

Register the adapter in `src/adapters/documents/index.js` (`PARSERS` and the kind detection)
so `ingest` and `doctor` can see it.

### AgentHost

```js
{
  name: 'my-agent',
  install: async (root, { project }) => ({ written: [], skipped: [] }),
}
```

`install` writes the host's entry files and returns the paths it wrote and the paths it left
alone. It must be idempotent: a second run writes nothing and reports every earlier path as
skipped. It must never overwrite a file a human wrote; PhDude marks its own files with a
managed marker and skips anything unmarked.

```js
import { agentHostContract } from '../../src/ports/agent-host.js';
agentHostContract(test, assert, { mkdtemp: mkroot, readFile }, myHost);
```

Then register the host in `src/adapters/cli/commands/init.js` so `--agents` accepts its name.

### SearchProvider

```js
{
  name: 'my-provider',
  requiresKey: 'PHDUDE_MY_PROVIDER_KEY',      // optional: the env var holding its API key
  filtersDateClientSide: true,                // optional: see below
  async search(query, { from, limit, signal }) => Candidate[],
}
```

A `Candidate` carries exactly `provider, external_id, title, authors, year, venue, doi, url,
abstract, type, open_access, cited_by` — the full typedef is in `src/ports/search-provider.js`.
A provider drops a work it cannot title or address (no title, no id) rather than emitting a
half-mapped candidate; DOIs are normalized to a lowercase bare `10.xxxx/...` string with
`normalizeDoi` (`src/domain/normalize.js`), never the resolver URL.

Every request goes through `fetchWithPolicy` (`src/adapters/search/http.js`): a 15 s
`AbortController` timeout merged with the caller's signal, exactly one retry on 429/503 with a
backoff capped at 2 s, a `phdude/<version>` User-Agent, and typed errors naming the provider — a
status the caller is responsible for (a non-429 4xx) is `VALIDATION`, everything else the
provider's own fault is `TOOL_MISSING`. `fetch` and `env` arrive through `deps`, never imported,
so tests never touch the network and a provider's API key never has to be read from
`process.env` directly.

```js
import { searchProviderContract } from '../../src/ports/search-provider.js';
import { fakeFetch } from '../support/fake-fetch.js';

searchProviderContract(
  test,
  assert,
  ({ fetch, env }) => myProvider({ fetch, env, version: '0.3.0' }),
  {
    fakeFetch,
    success: { routes: [...], expectMinResults: 3, expectFromInUrl: '...' },
    empty: { routes: [...] },
    rateLimited: { routes: [...] },
    serverError: { routes: [...] },
    malformed: { routes: [...] },
  },
);
```

The suite checks the normalized candidate shape, that `limit` and `from` are honoured, an empty
result set comes back as `[]`, a 429 retries exactly once and then succeeds, a 5xx and a
malformed body both become typed errors naming the provider, and an already-aborted signal
rejects. A provider that calls more than one endpoint per search (PubMed's esearch/esummary
pair, for instance) can hand the suite routes for each endpoint; the retry check looks for one
URL that was called exactly twice rather than assuming the whole search is one request.

A provider with no server-side date filter — arXiv is the one that ships this way — sets
`filtersDateClientSide: true` on the object it returns instead of `expectFromInUrl` on its
fixtures. The contract then checks the *results* (every candidate at or after `from`, applied by
the provider itself after fetching) rather than the request URL.

Register the adapter in `src/adapters/search/index.js` (`PROVIDER_FACTORIES`), keyed by the name
a workspace's `providers:` list in `.phdude/research-policy.yaml` would use — that key is also
the provider's own `name` and the `provider` field on every candidate it returns, so all three
must agree.

### AnalysisRunner

```js
{
  name: 'local',
  available: async (runtime) => boolean,
  run: async ({ runtime, script, args, cwd, env, timeoutMs })
    => ({ exitCode, signal, stdout, stderr, durationMs, timedOut }),
}
```

The one place a script in a workspace is allowed to run. `runtime` is the **resolved executable**,
not the logical name: the application calls `runtimeCommand(policy, analysis.runtime)` first, so
the adapter never reads a policy. `args` is an array and there is no shell, ever. `env` is what
the caller passes plus `PATH`, `HOME` and `LANG` — nothing else of the parent's environment
reaches the child.

Three outcomes, and the caller has to tell them apart:

| Result | Meaning |
| --- | --- |
| `exitCode: 0` | The script finished. Its output files are the contract, not its stdout. |
| `exitCode: n` | It failed. `stderr` holds what it said. |
| `exitCode: null, timedOut: true` | It outran `timeoutMs` and was killed. |
| `exitCode: null, timedOut: false` | Something else killed it; `signal` names what. Never a success. |

A timeout is a result, not a throw — the caller decides whether a timed-out run is worth
recording, and both `analyze run` and `figure build` record it. `localRunner` bounds a run by its
process group, so a script that traps `SIGTERM`, or leaves a child behind, still dies.

```js
import { analysisRunnerContract } from '../../src/ports/analysis-runner.js';
analysisRunnerContract(test, assert, myRunner, { scriptsDir: fixtures });
```

The suite spawns `process.execPath`, so it needs no interpreter beyond the Node running the tests.

Then wire the runner into `deps.runner` in `src/adapters/cli/run.js`.

### The results.json contract

An analysis script talks to PhDude through one file, at the path the analysis declares in
`outputs.results` (by default `analysis/out/<name>/results.json`):

```json
{
  "results": [
    { "key": "daily_use_by_channel",
      "summary": "Daily use is lowest in the social-media sample.",
      "values": { "mailing list": 0.75, "campus social media": 0.5 },
      "unit": "proportion" }
  ],
  "tables": [],
  "notes": []
}
```

`schemas/results-json.json` is that contract, and it is closed at both levels: an unknown key is
a `VALIDATION` error naming it. `key` and `summary` must be non-empty and `key` unique within the
file; `values` is an object. Each entry becomes a `RESULT-<hash of summary + analysis id>` with
`from` set to the analysis and `ext.analysis: {key, run_at, unit?}` recording where it came from.

**The summary is the identity.** Re-running with the same summary and the same values changes
nothing; the same summary with different values rewrites that result in place; a *changed* summary
mints a new result and marks the old one `rejected` with `superseded_by`. Put the finding in the
summary, not only in the values, or a real change will look like an edit.

A file PhDude cannot read — missing, unparseable, or off-contract — records **no run at all**, so
a run that produced nothing can never be the successful run that makes an analysis look up to
date. A script that exits non-zero is the opposite: the run is recorded, with the tail of its
stderr, and no result is written.

### Figure generators

A generator is an ordinary script. PhDude resolves two kinds and nothing else: `phdude:<name>`
for one the package ships in `generators/`, and a path under `figures/` for one the workspace
holds. It is run through the AnalysisRunner like any analysis, under the same execution policy.

```
node generators/bar-chart.mjs --input <results.json|dataset.csv> --key <result key|column> \
  --out <figures/out/name.svg> --title "<title>" --alt "<what the figure shows>"
```

The arguments come from the figure record's `generator.args`, verbatim, as an array. A generator
gets `PHDUDE_WORKSPACE` and `PHDUDE_FIGURE`, runs with the workspace as its working directory, and
must refuse an absolute or `..` path — its arguments come from a file a researcher can edit. It
must write every path the figure declares under `outputs`; exiting 0 without writing them is
treated as a failure, because hashing whatever happens to be there would record a run that did
not happen.

Determinism is the requirement that makes the rest work: the same input must produce the same
bytes, so no timestamps, no random ids, no fonts fetched at draw time. `tests/golden/bar-chart.test.js`
holds the shipped generator to that byte for byte.

To ship another one, add it to `generators/`, register it in `SHIPPED_GENERATORS` in
`src/domain/figures.js`, and add it to `files` in `package.json` if it needs a new directory.

### DocumentRenderer

```js
{
  name: 'pandoc',
  formats: ['docx', 'html', 'latex', 'md', 'pptx'],
  available: async () => ({ ok, version, hint }),
  render: async ({ input, output, cwd }) => ({ path, warnings }),
}
```

`input` is `{ markdownPath, bibPath?, cslPath?, referenceDoc?, template?, metadata? }`, `output`
is `{ path, format }`, and `metadata` is a flat map of scalars and arrays of scalars (`title`,
`author`, `date`, `abstract`). A fixed `date` is what makes two builds of the same manuscript
produce the same bytes, so the build passes one rather than letting the tool reach for the clock.

Four rules, in this order, and the order is the interesting part:

| Situation | Answer |
| --- | --- |
| A format the renderer does not declare, or an input file nobody wrote | `VALIDATION`, whether or not the tool is installed |
| The tool is not installed | `TOOL_MISSING` carrying the install hint |
| Anything else | Create the output's parent directory, render, return the absolute path |
| An input this renderer cannot honour (a CSL style, a `--reference-doc`) | A **warning naming the file**, never a silent drop |

A malformed request stays malformed on a machine that has every tool, which is why validation
comes first: answering `TOOL_MISSING` over a typo would send a researcher off to install Pandoc.
And the *artifact* decides whether a render succeeded, never the exit code — a tool that exits 0
and writes nothing is an `EXECUTION` failure, because hashing whatever happens to be at that path
would record a render that did not happen.

```js
import { documentRendererContract } from '../../src/ports/document-renderer.js';
documentRendererContract(test, assert, myRenderer, { fixturesDir: FIXTURES });
```

The suite checks the shape, that `available()` reports honestly and stably, both `VALIDATION`
paths, and then — for every format the renderer declares — either a rendered file (non-empty,
with the fixture's text in it, or the right magic bytes for a binary format) or a `TOOL_MISSING`
refusal, whichever the machine warrants. For `md`, `latex` and `html` it also renders twice and
compares bytes: identical inputs and an identical renderer version must produce identical files,
which is what lets the build cache treat "the inputs did not change" as "the output would not
change". DOCX, PPTX and PDF are best-effort and not held to that (see
[ADR 10](adr/0010-renderer-adapters-and-reproducible-builds.md)).

**Precedence.** `buildRenderers({ execFile, env, version, paths })` returns
`[markdown, pandoc, latex]` and `rendererFor(renderers, format)` takes the first renderer that
declares the format:

| Format | Renderer | Needs |
| --- | --- | --- |
| `md` | `markdown` (built in) | nothing |
| `docx`, `pptx`, `html`, `latex` | `pandoc` | pandoc |
| `pdf` | `latex` | pandoc **and** `latexmk` or `pdflatex` |

`md` goes to the built-in renderer *even where Pandoc is installed*: the one format that must
never depend on a tool must not quietly start depending on one. The built-in renderer resolves
`[@key]`, `[@a; @b]`, `[-@key]` and `[@key, p. 3]` into plain `(Surname, Year)` forms and appends
a `## References` list holding the entries actually cited, in author-year order, read out of
`references.bib` by `parseBibtex`. It is one fixed style and says so: a venue's style is what
`--csl` and Pandoc are for, and a CSL file handed to it comes back as a warning.

`PHDUDE_PANDOC`, `PHDUDE_LATEXMK`, `PHDUDE_PDFLATEX` and `PHDUDE_BIBTEX` point an adapter at a
user-local install; `paths` does the same from code. Every tool is called with `execFile` and an
argument array, never a shell.

Then wire the renderers into `deps.renderers` in `src/adapters/cli/run.js`; `phdude doctor` picks
them up from there and prints one line each.

### Store

`src/ports/store.js` documents the storage interface used by every use case. `FsStore` is the
only implementation today; a use case, and every migration step, must depend on the port rather
than on the class.

## Layering

```
domain      pure functions and types; imports nothing from the rest of the tree
application use cases; imports domain and ports only
adapters    implement ports; may import domain and application
bin         wires adapters into use cases
```

`tests/unit/layering.test.js` enforces the first two rules by scanning imports. If your
change makes that test fail, the dependency is pointing the wrong way.

## Before opening a pull request

```
npm run format
npm run lint
npm test
```

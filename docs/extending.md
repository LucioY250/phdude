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

A pack is a directory holding `pack.yaml` and its own skill Markdown. It carries vocabulary
and recommendations, never executable code. Built-in packs live under `packs/fields/` and
`packs/methods/`; a workspace can add its own under `.phdude/packs/<kind>/<name>/`, and a
workspace pack with the same name overrides the built-in one.

```yaml
schema: phdude.pack
version: 1
name: quantitative
kind: method                # field | method (venue is reserved for v0.6)
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

`writes` stays empty for every skill that ships today, because a skill never edits the workspace
directly: it runs `phdude add`, `phdude decide` and the other write commands, so the runtime
validates, hashes, attributes and logs each change. See
[ADR 4](adr/0004-agent-writes-through-cli.md).

Skills in `skills/` are copied into `.phdude/skills/` by `phdude init`. `tests/unit/skills.test.js`
checks that every shipped skill has valid front matter and declares no writes;
`tests/contracts/skills.test.js` checks that every shipped skill (core and packs) loads and
validates against the skill contract schema below.

### Skill contract

The `phdude:` block is validated against `schemas/skill.json` (`$id: phdude://skill`). Only the
block itself is checked, not the rest of the front matter.

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `version` | yes | `1` | The only supported contract version. |
| `reads` | yes | `string[]` | Workspace globs the skill reads. |
| `writes` | yes | `string[]` | Workspace globs the skill writes directly. Empty for every core and pack skill (see above); non-empty is reserved for a future manuscript-writing skill. |
| `permissions` | yes | object | `{ network: 'none'\|'allowed', workspace: string[] }`. `workspace` is one or more of `read`, `write:manuscript`, `write:knowledge`, `write:sources`, at least one entry. |
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

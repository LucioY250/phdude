# Extension API reference

Seven extension points, each a documented JavaScript interface or file format with a contract
suite any implementation must pass. This page is the reference: signature, lifecycle, error
behaviour, stability and registration, one section per port. [Extending PhDude](extending.md) is
the guide that says *where a change belongs*; read that first if you are not sure yet whether you
are writing a pack, a skill or an adapter.

Every port lives in [`src/ports/`](../src/ports/) as a JSDoc typedef plus an exported
`…Contract(test, assert, …)` function. The typedef is the interface, the contract function is the
test suite, and they ship together on purpose: register your implementation with the suite and the
tests come with it.

## The extension points

| Port | Kind | Stability | Since | How a build gets one today |
| --- | --- | --- | --- | --- |
| [`SearchProvider`](#searchprovider) | code | stable | 0.3.0 | `PROVIDER_FACTORIES` in `src/adapters/search/index.js` |
| [`DocumentParser`](#documentparser) | code | stable | 0.1.0 | `PARSERS` in `src/adapters/documents/index.js` |
| [`DocumentRenderer`](#documentrenderer) | code | stable | 0.6.0 | `buildRenderers` in `src/adapters/render/index.js` |
| [`AnalysisRunner`](#analysisrunner) | code | stable | 0.5.0 | `deps.runner` in `src/adapters/cli/run.js` |
| [`AgentHost`](#agenthost) | code | stable | 0.1.0 | `HOSTS` in `src/adapters/agents/hosts.js` |
| [`ResearchPack`](#researchpack) | data | stable | 0.1.0 | `.phdude/packs/<kind>/<name>/` in the workspace |
| [`ResearchSkill`](#researchskill) | data | stable | 0.1.0 | `phdude skills install`, or a pack that bundles it |
| [`Store`](#store) | internal | stable | 0.1.0 | not an extension point; see below |

**Read the last column before you start.** PhDude loads no JavaScript from outside the package:
there is no plugin loader, no `plugins:` key, and nothing in a workspace is ever executed. The
five code ports are extended by registering an adapter *in the package* — a pull request, or a
fork you build from. The two data ports are the ones a workspace installs on its own, and they are
data precisely so that adopting one is not a decision to run somebody else's code.

That is a deliberate boundary, not an unfinished feature (PRD §119). What the contract suites buy
you is that an adapter written against a port keeps working across a 1.x upgrade, and that a
maintainer reviewing your pull request has a suite to run rather than an opinion to form.

## Stability

The interfaces above are frozen for 1.x. Within that line:

- A port never loses a property, and a property never changes type or meaning.
- A new **optional** property may be added; an implementation that does not set it keeps working.
  `SearchProvider.filtersDateClientSide` (0.3) and the skill contract's `permissions.execution`
  (0.5) were both added that way.
- A contract suite may gain a test for behaviour the port already required. It will not gain a
  test for a new requirement without a minor-version bump and a note in the CHANGELOG.
- Removing a property, or making an optional one required, is a major version.

Schemas carry their own freeze, `x-phdude: { stability, since }`, checked by
`tests/contracts/schema-stability.test.js`. `docs/versioning.md` is the SemVer and deprecation
policy for the CLI and the package as a whole.

## Errors

Every port reports failure with the same typed error:

```js
import { PhdudeError } from '../../domain/errors.js';

throw new PhdudeError(code, message, hint, details);
```

| Code | Exit | What it means for an adapter |
| --- | --- | --- |
| `USAGE` | 1 | The caller named something that does not exist — an unknown provider, an unknown host. |
| `VALIDATION` | 2 | The request is malformed, or the outside world answered with something off-contract. |
| `POLICY` | 3 | The workspace's own rules refuse this — a skill asking for a permission the policy has not opened. |
| `TOOL_MISSING` | 4 | PhDude did its part and the thing it called did not come back: a tool that is not installed, a provider that is down, a request that timed out. |
| `EXECUTION` | 4 | A declared run produced nothing usable — a tool that exits 0 and writes no file. |

`message` is one sentence naming what failed and which adapter it failed in. `hint` is the action
that would fix it, and every `TOOL_MISSING` carries one — the contract suites check for it,
because "pandoc is not available" without "install pandoc" is a dead end. `details` is an optional
array printed above the message, which is how a gate's located findings reach the researcher
before the sentence counting them.

**Raise the class, not the shape.** `src/adapters/cli/run.js` renders a typed error and maps it to
its exit code with `err instanceof PhdudeError`; an error that merely *looks* like one prints
without its hint and exits 1. The contract suites check `err.name === 'PhdudeError'` and `err.code`
structurally, so the standalone examples under `examples/extensions/` can satisfy them without
depending on PhDude — but an adapter that ships inside a build imports the class.

## Running a contract suite

Each suite is an ordinary function that registers `node:test` cases. Put your implementation in a
test file, call the suite, run the file:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { documentParserContract } from '../../src/ports/document-parser.js';
import { myParser } from '../../src/adapters/documents/my-parser.js';

documentParserContract(test, assert, myParser, [['sample.rtf', fx('sample.rtf')]]);
```

```
node --test tests/contracts/my-parser.test.js
npm test                      # the whole pyramid, contract suites included
```

No suite touches the network, and none needs a runtime beyond the Node running the tests. A suite
whose subject depends on an external tool checks the *refusal* where the tool is absent, so CI
without pandoc still holds the renderer to its contract.

---

## SearchProvider

**Purpose.** One literature source, normalized. A provider turns its own API's vocabulary into
PhDude's `Candidate` shape so the domain never sees a provider's field names. Five ship: OpenAlex,
Crossref, arXiv, Semantic Scholar and PubMed.

**Interface** — [`src/ports/search-provider.js`](../src/ports/search-provider.js)

```js
{
  name: 'my-provider',
  requiresKey: 'PHDUDE_MY_PROVIDER_KEY',   // optional: the env var holding its API key
  filtersDateClientSide: true,             // optional: no server-side date filter
  async search(query, { from, limit, signal }) { return [/* Candidate */]; },
}
```

A `Candidate` carries exactly these twelve keys, no more and no fewer:

| Key | Type | Notes |
| --- | --- | --- |
| `provider` | `string` | The provider's own `name`. The contract checks they agree. |
| `external_id` | `string` | The provider's id for the work. Non-empty. |
| `title` | `string` | Non-empty after trimming. |
| `authors` | `string[]` | May be empty; never `null`. |
| `year` | `number\|null` | An integer or nothing. |
| `venue` | `string\|null` | |
| `doi` | `string\|null` | Lowercase, bare `10.xxxx/...`, never the resolver URL. |
| `url` | `string\|null` | |
| `abstract` | `string\|null` | |
| `type` | enum | `article`, `preprint`, `book`, `chapter` or `other`. |
| `open_access` | `boolean\|null` | `null` where the API said nothing. Guessing is a claim about the source. |
| `cited_by` | `number\|null` | A non-negative integer or nothing. |

**Lifecycle.** A factory takes `{ fetch, env, version, mailto }` and returns the provider. `fetch`
and `env` arrive through `deps` and are never imported, so a test never touches the network and an
API key never has to be read out of `process.env` inside the adapter. `search` is called once per
provider per query, concurrently with the others; it holds no state between calls.

Every request goes through `fetchWithPolicy` ([`src/adapters/search/http.js`](../src/adapters/search/http.js)):
a 15 s `AbortController` timeout merged with the caller's signal, exactly one retry on 429 and 503
with the backoff the provider asked for capped at 2 s, and a `phdude/<version>` User-Agent.

Three rules the mapping follows. A work with no title or no id is **dropped**, not half-mapped —
a candidate a researcher cannot name is not a candidate. DOIs go through `normalizeDoi`
([`src/domain/normalize.js`](../src/domain/normalize.js)). And `limit` is a promise the provider
keeps whatever the API returned.

**Errors.**

| Situation | Code |
| --- | --- |
| A 5xx, a timeout, a transport failure, the caller's abort | `TOOL_MISSING`, message naming the provider |
| A 4xx that is not 429 | `VALIDATION` — we asked wrongly |
| A body that is not JSON, or is JSON of the wrong shape | `VALIDATION` naming the provider |

**Contract suite.** `searchProviderContract(test, assert, makeProvider, fixtures)`. It builds the
provider from recorded routes, so the caller passes its own `fakeFetch` in — test support cannot
be imported from `src/`.

```js
searchProviderContract(test, assert, ({ fetch, env }) => myProvider({ fetch, env, version }), {
  fakeFetch,
  success: { routes: [...], expectMinResults: 3, expectFromInUrl: 'from-pub-date:2021' },
  empty: { routes: [...] },
  rateLimited: { routes: [{ ..., status: 429, times: 1 }, { ... }] },
  serverError: { routes: [...] },
  malformed: { routes: [...] },
});
```

It checks the candidate shape, `limit`, `from`, an empty result set as `[]`, exactly one retry
after a 429, the two typed errors, and an already-aborted signal. A provider that calls more than
one endpoint per search (PubMed's esearch/esummary pair) hands the suite routes for each; the
retry check looks for one URL called exactly twice rather than assuming a search is one request.
A provider with no server-side date filter sets `filtersDateClientSide: true` instead of
`expectFromInUrl`, and the suite then checks the filtered results rather than the request URL.

**Registration.** `PROVIDER_FACTORIES` in [`src/adapters/search/index.js`](../src/adapters/search/index.js),
keyed by the name a workspace's `providers:` list in `.phdude/research-policy.yaml` would use.
That key, the provider's own `name`, and the `provider` field on every candidate it returns must
all be the same string.

**Example.** [`examples/extensions/search-provider-example/`](../examples/extensions/search-provider-example/)

---

## DocumentParser

**Purpose.** Text, sections and tables out of one document kind, so `ingest` can inventory a
source and cache what it says. Three ship: plain text and Markdown and CSV (`text`), the OOXML
family (`ooxml`), and PDF through `pdftotext` (`pdf`).

**Interface** — [`src/ports/document-parser.js`](../src/ports/document-parser.js)

```js
{
  name: 'my-parser',
  kinds: ['rtf'],
  async available() { return true; },
  async parse(buffer, { path }) {
    return { text, sections, tables, meta, warnings };
  },
}
```

`sections` are `{ title, text }`; `tables` are `{ name, rows }` where `rows` is an array of string
arrays; `meta` is the parser's own vocabulary, passed through and never branched on; `warnings` is
what the parser could not do.

**Lifecycle.** A parser is a module-level object, not a factory: it holds no configuration and no
state. `available()` probes whatever external tool the parser needs, and is called by `ingest` and
by `phdude doctor`. When it returns false the artifact is still inventoried and hashed, and the
extraction status explains what is missing — a missing tool never loses the record of the file.

**Parsing is pure and idempotent.** The same buffer always yields the same result: no clock, no
counter, no filesystem. The contract parses each fixture twice and compares with `deepEqual`.

**Errors.** A parser barely raises any. What it cannot read is a `warnings` entry, and an empty
buffer is a document with nothing in it. Raise `VALIDATION` only where the bytes claim to be a
format and are not.

**Contract suite.** `documentParserContract(test, assert, parser, fixtures)`, where `fixtures` is
an array of `[name, Buffer | Promise<Buffer>]`.

```js
documentParserContract(test, assert, myParser, [['sample.rtf', fx('sample.rtf')]]);
```

It checks the result shape and idempotency for each fixture, and that an empty buffer does not
throw.

**Registration.** `PARSERS` in [`src/adapters/documents/index.js`](../src/adapters/documents/index.js),
plus the kind detection in `detectKind` if the format has magic bytes or a new extension.
`parserFor(kind)` takes the first parser that declares the kind, so order is precedence.

**Example.** [`examples/extensions/document-parser-example/`](../examples/extensions/document-parser-example/)

---

## DocumentRenderer

**Purpose.** The assembled manuscript to one output format. Three ship: `markdown` (built in),
`pandoc` and `latex`.

**Interface** — [`src/ports/document-renderer.js`](../src/ports/document-renderer.js)

```js
{
  name: 'my-renderer',
  formats: ['rtf'],                                  // lowercase
  async available() { return { ok, version, hint }; },
  async render({ input, output, cwd }) { return { path, warnings }; },
}
```

`input` is `{ markdownPath, bibPath?, cslPath?, referenceDoc?, template?, metadata? }` and
`output` is `{ path, format }`. `metadata` is a flat map of scalars and arrays of scalars —
`title`, `author`, `date`, `abstract`. A fixed `date` is what makes two builds of the same
manuscript produce the same bytes, so the build passes one rather than letting a tool reach for
the clock.

`available()` returns `{ ok: true, version }` or `{ ok: false, hint }`: an available renderer names
the version that produced the bytes, and an unavailable one names what would install it. It must
be stable — the contract calls it twice and compares.

**Lifecycle, and the order is the interesting part.**

| Situation | Answer |
| --- | --- |
| A format the renderer does not declare, or an input file nobody wrote | `VALIDATION`, whether or not the tool is installed |
| The tool is not installed | `TOOL_MISSING` carrying the install hint |
| Anything else | Create the output's parent directory, render, return the absolute path |
| An input this renderer cannot honour (a CSL style, a `--reference-doc`) | A **warning naming the file**, never a silent drop |

Validation comes first because a malformed request stays malformed on a machine that has every
tool: answering `TOOL_MISSING` over a typo would send a researcher off to install pandoc. And the
*artifact* decides whether a render succeeded, never the exit code — a tool that exits 0 and
writes nothing is an `EXECUTION` failure, because hashing whatever happens to be at that path
would record a render that did not happen.

**Reproducibility.** `md`, `latex` and `html` are held to it: identical inputs and an identical
renderer version must write identical bytes, which is what lets the build cache read "the inputs
did not change" as "the output would not change". DOCX, PPTX and PDF are best-effort — see
[ADR 10](adr/0010-renderer-adapters-and-reproducible-builds.md).

**Errors.** `VALIDATION` for a malformed request, `TOOL_MISSING` with an install hint for an
absent tool, `EXECUTION` for a run that produced no artifact.

**Contract suite.** `documentRendererContract(test, assert, renderer, { fixturesDir })`, where
`fixturesDir` holds a `sample.md` whose text the output must carry.

```js
documentRendererContract(test, assert, myRenderer, { fixturesDir: FIXTURES });
```

It checks the shape, `available()`'s honesty and stability, both `VALIDATION` paths, and then —
per declared format — either a rendered file (non-empty, carrying the fixture's text, or the right
magic bytes for a binary format) or a `TOOL_MISSING` refusal, whichever the machine warrants. For
`md`, `latex` and `html` it renders twice and compares bytes.

**Registration.** `buildRenderers({ execFile, env, version, paths })` in
[`src/adapters/render/index.js`](../src/adapters/render/index.js) returns the renderers in
precedence order, and `rendererFor(renderers, format)` takes the first that declares the format;
`deps.renderers` in `src/adapters/cli/run.js` is where the array reaches the use cases. Every
external tool is called with `execFile` and an argument array, never a shell.

**Example.** [`examples/extensions/renderer-example/`](../examples/extensions/renderer-example/)

---

## AnalysisRunner

**Purpose.** The one place a script in a workspace is allowed to run. One ships, `localRunner`.

**Interface** — [`src/ports/analysis-runner.js`](../src/ports/analysis-runner.js)

```js
{
  name: 'local',
  async available(runtime) { return true; },
  async run({ runtime, script, args, cwd, env, timeoutMs }) {
    return { exitCode, signal, stdout, stderr, durationMs, timedOut };
  },
}
```

`runtime` is the **resolved executable**, not the logical name: the application calls
`runtimeCommand(policy, analysis.runtime)` first, so the adapter never reads a policy. `script` is
its first argument, resolved by the runtime relative to `cwd`. `args` is an array and there is no
shell, ever. `env` is the whole environment the script gets on top of the runner's minimal set
(`PATH`, `HOME`, `LANG`) — nothing else of the parent's environment reaches the child.

**Lifecycle.** A finished run is a result, not an exception. Only a runner that could not start
the process at all throws, and the caller has to tell four outcomes apart:

| Result | Meaning |
| --- | --- |
| `exitCode: 0` | The script finished. Its output files are the contract, not its stdout. |
| `exitCode: n` | It failed. `stderr` holds what it said. |
| `exitCode: null, timedOut: true` | It outran `timeoutMs` and was killed. |
| `exitCode: null, timedOut: false` | Something else killed it; `signal` names what. Never a success. |

A timeout is recorded rather than thrown, because the caller decides whether a timed-out run is
worth recording — `analyze run` and `figure build` both record it. `localRunner` bounds a run by
its process group, so a script that traps `SIGTERM` or leaves a child behind still dies.

**Errors.** One: a runtime that is not installed is `TOOL_MISSING`, naming the runtime and
carrying a hint. Everything else is a `RunResult`.

**Contract suite.** `analysisRunnerContract(test, assert, runner, { scriptsDir })`, where
`scriptsDir` holds the suite's Node fixtures (`echo.mjs`, `fail.mjs`, `sleep.mjs`, `signal.mjs`).

```js
analysisRunnerContract(test, assert, myRunner, { scriptsDir: FIXTURES });
```

The suite spawns `process.execPath`, so it needs no interpreter beyond the Node running the tests.
It checks a successful run's stdout, that the script sees `cwd` and only the environment it was
handed, a non-zero exit reported rather than thrown, a timeout, a signal kill, `available()` on a
present and an absent runtime, and the `TOOL_MISSING` refusal.

**Registration.** `deps.runner` in [`src/adapters/cli/run.js`](../src/adapters/cli/run.js).
Whether a script runs at all is `execution.enabled` in `.phdude/research-policy.yaml`, checked by
the use case before the runner is ever called.

**Related contracts.** An analysis script talks to PhDude through
[`schemas/results-json.json`](../schemas/results-json.json), and a figure generator through its
declared `outputs`. Both are documented in [Extending PhDude](extending.md#the-resultsjson-contract).

---

## AgentHost

**Purpose.** The entry files one coding agent reads. Two ship: `claude-code` and `codex`.

**Interface** — [`src/ports/agent-host.js`](../src/ports/agent-host.js)

```js
{
  name: 'my-agent',                                  // matches /^[a-z-]+$/
  async install(root, { project, skills, skillsDir, commandsDir }) {
    return { written: [], skipped: [] };
  },
}
```

`written` and `skipped` are workspace-relative paths.

**Lifecycle.** `install` is called by `phdude init`, and again by every command that has to
refresh the agent files — `phdude skills install` and `remove` rewrite the skill index. So it runs
many times over the life of a workspace, and two rules follow:

- **Idempotent.** A second run writes nothing and reports every earlier path as `skipped`, with
  the bytes unchanged. The contract checks this.
- **It never overwrites a file a human wrote.** PhDude marks its own files with a managed marker
  and skips anything unmarked. A pre-existing `AGENTS.md` — including one with malformed front
  matter — is left exactly as it was.

Every file a host writes mentions `phdude`, so a researcher reading their own repository can tell
where the file came from. The contract checks that too.

**Errors.** `USAGE` for a host name that does not exist, raised by the registry rather than the
host. A host that cannot write reports the failure through the filesystem error it got.

**Contract suite.** `agentHostContract(test, assert, { mkdtemp, readFile }, host)` — the io
functions are injected so the suite creates its temp roots the way the caller wants.

```js
agentHostContract(test, assert, { mkdtemp: mkroot, readFile }, myHost);
```

**Registration.** `HOSTS` in [`src/adapters/agents/hosts.js`](../src/adapters/agents/hosts.js),
which is what `phdude init --agents <name>` accepts and what `phdude.yaml` records. `knownHosts`
ignores a name this build does not know, so a workspace written by a later PhDude does not break
an earlier one mid-command. The shared templates live in `src/adapters/agents/shared.js`.

An agent that reads `AGENTS.md` and needs no host-specific files — Gemini CLI is one — needs no
adapter at all: any host that writes `AGENTS.md` serves it.

---

## ResearchPack

**Purpose.** How PhDude adapts to a field, a method or a venue: vocabulary, reviewer
perspectives, recommended checks, detection keywords, and bundled skills. Data, never code.

**Format** — `pack.yaml`, validated against [`schemas/pack.json`](../schemas/pack.json)
(`$id: phdude://pack`), `additionalProperties: false`.

| Key | Type | Notes |
| --- | --- | --- |
| `schema` | `"phdude.pack"` | |
| `version` | `1` | |
| `name` | `string` | `^[a-z0-9-]+$`, unique per discovery root |
| `kind` | enum | `field`, `method` or `venue` |
| `description` | `string` | |
| `terminology` | `string[]` | Vocabulary the agent should prefer |
| `detect.keywords` | `string[]` | Scored against cached text by `phdude packs detect`; `[]` for a venue |
| `reviewers` | `string[]` | Reviewer perspectives this discipline expects |
| `recommended_checks` | `string[]` | |
| `skills` | `string[]` | Paths relative to the pack directory; `[]` for a venue |
| `schemas` | `string[]` | Optional extra JSON Schemas for `ext.<pack>` fields |

A venue pack also carries `profile.yaml`, validated against
[`schemas/profile.json`](../schemas/profile.json) (`phdude.profile` v1, since 0.4.0; the venue
pack kind itself since 0.6.0), plus its CSL style and LaTeX template.

**Lifecycle.** `discoverPacks(roots)` walks the roots in order — the package's `packs/`, then the
workspace's `.phdude/packs/` — and a later root's pack overrides an earlier one of the same name.
`phdude packs detect` scores keywords and *recommends*; `phdude packs apply <name>` records the
pack in `phdude.yaml` and writes one event. Applying checks every bundled skill first and refuses
the whole pack with `POLICY` if one asks for a permission the research policy has not opened —
adopting half a pack is not what anyone asked for.

**Errors.** `VALIDATION` for a `pack.yaml` that fails the schema, a missing skill file, or a path
that escapes the pack directory (absolute, `..`, a NUL byte, or a symlink pointing out).
`POLICY` for the permission refusal above.

**Contract suite.** [`tests/contracts/packs.test.js`](../tests/contracts/packs.test.js) validates
every pack under `packs/`. To run yours through the loaders, point them at your root:

```js
const packs = await discoverPacks([DEFAULT_PACKS_DIR, myRoot]);
const pack = await loadPack(join(myRoot, 'fields', 'my-field'));
```

**Registration.** Copy the pack into `<workspace>/.phdude/packs/<kind>/<name>/` and run
`phdude packs apply <name>`. No code change, no restart, no build.

**Authoring guide.** [docs/packs-authoring.md](packs-authoring.md).
**Example.** [`examples/extensions/pack-example/`](../examples/extensions/pack-example/)

---

## ResearchSkill

**Purpose.** What PhDude knows how to do, written for the agent to read. An open Agent Skills
directory with a `SKILL.md`, plus PhDude's research contract in its front matter.

**Format** — the `phdude:` block, validated against [`schemas/skill.json`](../schemas/skill.json)
(`$id: phdude://skill`), `additionalProperties: false` on the block and on `permissions`.

```yaml
---
name: my-skill
description: One sentence saying what this skill is for.
phdude:
  version: 1
  reads: [knowledge/claims/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---
```

`version`, `reads`, `writes` and `permissions` are required; `objects`, `artifacts`,
`evidence_requirements`, `provenance`, `approval_gates`, `quality_gates`, `dependencies` and
`tests` are optional. `permissions.workspace` is one or more of `read`, `write:manuscript`,
`write:knowledge`, `write:sources`. `permissions.execution` is optional and defaults to `none`, so
every skill written before 0.5 stays valid.

**Lifecycle.** `discoverSkills(roots)` walks the package's `skills/`, each applied pack's skill
directories, then `<workspace>/.phdude/skills/`, and a later root overrides an earlier one of the
same name. One unloadable skill aborts the whole discovery, which is what `init` and `packs apply`
need; `phdude doctor` passes an `onError` callback to opt out, so a broken skill costs one warning
rather than the entire report.

**Least privilege by default.** A skill with no `phdude:` block still loads — the open convention
does not require one — but gets `{ version: 1, reads: [], writes: [], permissions: { network:
'none', workspace: ['read'] } }` and a warning. A block that is present but invalid fails to load.

**Errors.** `VALIDATION` when the front-matter `name` does not match the directory, or the
`phdude:` block fails the schema. `POLICY` when the skill asks for network or execution the
research policy has not opened, and for a skill whose declared purpose is detector evasion or
"humanizing" — PhDude has no detector score and will not install a skill that offers one
(PRD §30c).

**Contract suite.** [`tests/contracts/skills.test.js`](../tests/contracts/skills.test.js) loads
every shipped and pack skill. For your own:

```js
const skill = await loadSkill('/path/to/skills/my-skill');
assert.equal(skill.contract.version, 1);
assert.deepEqual(skill.warnings, []);
```

**Registration.** `phdude skills install <path|git-url>` copies the files into
`.phdude/skills/<name>/`, records `{ name, source, hash, installed_at }` in
`.phdude/skills-lock.yaml`, writes one event, and rewrites the skill index in `AGENTS.md` and
`CLAUDE.md`. Nothing inside a skill is ever executed.

**Authoring guide.** [docs/skills-authoring.md](skills-authoring.md).
**Example.** the skill bundled in [`examples/extensions/pack-example/`](../examples/extensions/pack-example/).

---

## Store

[`src/ports/store.js`](../src/ports/store.js) documents the storage interface every use case and
every migration step depends on. `FsStore` is the only implementation, and it is **not an
extension point**: it is listed here so that a use case or a migration is written against the port
rather than the class. If you are writing a migration step, the store is all it gets — no
`node:fs`, no network — which is what makes it testable against a temporary directory and unable
to reach outside the workspace.

## The example extensions

| Example | Port |
| --- | --- |
| [`search-provider-example/`](../examples/extensions/search-provider-example/) | `SearchProvider` |
| [`document-parser-example/`](../examples/extensions/document-parser-example/) | `DocumentParser` |
| [`renderer-example/`](../examples/extensions/renderer-example/) | `DocumentRenderer` |
| [`pack-example/`](../examples/extensions/pack-example/) | `ResearchPack` + `ResearchSkill` |

All four are MIT, dependency-free, and import nothing from PhDude.
[`tests/contracts/example-extensions.test.js`](../tests/contracts/example-extensions.test.js) runs
each of them through the matching contract suite on every `npm test`:

```
node --test tests/contracts/example-extensions.test.js
```

They are in the repository, not in the published package: `examples/` is not in `package.json`'s
`files`, and each example's own `package.json` is marked `private`.

## Before opening a pull request

```
npm run format
npm run lint
npm test
```

`tests/unit/layering.test.js` enforces the dependency direction — domain imports nothing from the
rest of the tree, application imports domain and ports only, adapters implement ports. If your
change makes it fail, the dependency is pointing the wrong way.

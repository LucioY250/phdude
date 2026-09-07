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

`writes` stays empty for every v0.1 skill, because a skill never edits the workspace
directly: it runs `phdude add`, `phdude decide` and the other write commands, so the runtime
validates, hashes, attributes and logs each change. See
[ADR 4](adr/0004-agent-writes-through-cli.md).

Skills in `skills/` are copied into `.phdude/skills/` by `phdude init`. `tests/unit/skills.test.js`
checks that every shipped skill has valid front matter and declares no writes.

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

### Store

`src/ports/store.js` documents the storage interface used by every use case. Only
`FsStore` implements it in v0.1; a use case must depend on the port, never on the class.

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

# Versioning and stability

A research project outlives the tool that helped write it. The version number is how PhDude says
whether the workspace on your disk, the script that reads its JSON, and the extension you wrote
last year will still work after you upgrade.

PhDude follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). `phdude --version`
prints the version of the package you have installed.

| Bump | What it means |
|---|---|
| MAJOR | Something that used to work stops working, or quietly means something else. A required field appears, a value leaves an enum, a flag is removed, an exit code changes. |
| MINOR | New commands, new flags, new schemas, new optional fields, new rules in `next` or `gaps`. Everything that worked before still works. |
| PATCH | A fix. Behaviour that was already documented starts matching the documentation. |

Releases 0.1 through 0.7 predate this promise: they were the build-out, and each one moved the
workspace forward. `CHANGELOG.md` lists every such change under **Breaking changes since 0.1**.
From 1.0 on, the surface below is frozen and the rules on this page apply.

## What the promise covers

| Surface | Where it lives | What holds it still |
|---|---|---|
| Command names, sub-commands, and the options each accepts | `src/adapters/cli/args.js` | `tests/unit/cli/surface.test.js`, `tests/unit/cli/docs-flags.test.js` |
| Exit codes | `src/domain/errors.js` | `tests/contracts/cli-json-shape.test.js` |
| The `--json` error envelope | `src/adapters/cli/run.js` | `tests/contracts/cli-json-shape.test.js` |
| Object schemas | `schemas/*.json` | `tests/fixtures/schema-snapshot.json`, `tests/contracts/schema-stability.test.js` |
| The workspace layout and `workspace_version` | `docs/workspace.md`, `migrations/` | `tests/integration/migrate.test.js` |
| The event log | `schemas/event.json`, `.phdude/events.jsonl` | the schema snapshot |
| The extension ports | `src/ports/*.js` | the contract suite each port exports |
| The skill contract | `schemas/skill.json` | `tests/contracts/skills.test.js` |
| The pack and venue-profile formats | `schemas/pack.json`, `schemas/profile.json` | `tests/contracts/packs.test.js` |
| The `results.json` a researcher's script writes | `schemas/results-json.json` | `tests/integration/analyze.test.js` |

Every command marked `Stability: stable` in [docs/cli.md](cli.md) is covered. All of them are, at
1.0.

## What the promise does not cover

- **Module paths under `src/`.** The package's entry point is the `phdude` binary. Importing
  `phdude/src/...` is reaching into the engine, and the engine is rearranged whenever that helps.
- **The wording of human-readable output.** Reports are written for people and get rewritten when
  a sentence turns out to mislead. A script that parses the text of `phdude status` is reading
  prose; read `--json` instead, which is frozen.
- **`.phdude/cache/`.** Extracted text, review contexts and build intermediates. Disposable by
  design, gitignored, and rebuilt on demand.
- **`PHDUDE_FAKE_FETCH`.** A test-only hook, documented as internal in `docs/cli.md`.
- **The order of `next` candidates below the top one,** and the exact scores behind Research
  Health. The dimensions and the formulas are documented (ADR 11); the numbers move when a
  formula is corrected, which is a fix, not a break.

## Schemas

Every file in `schemas/` carries its own stability marker:

```json
{
  "$id": "phdude://fact",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "x-phdude": { "stability": "stable", "since": "0.1" }
}
```

`since` is the release the shape first shipped in, not the release that last touched the file. It
tells a reader how long the shape has been true, and it is the field that has to move before the
frozen contract may.

`tests/fixtures/schema-snapshot.json` records, for every schema, its `$id`, its stability marker
and the keywords that decide whether a document already on disk is still valid:

- every `required` list, at every depth
- every `enum` and every `const`
- `additionalProperties` and `unevaluatedProperties`
- every `$ref`

Adding a property under `properties` changes none of those, so it costs an existing workspace
nothing and needs no ceremony. Adding a name to `required`, dropping a value from an `enum`,
opening a closed object or repointing a `$ref` changes what a valid document is.
`tests/contracts/schema-stability.test.js` fails on any of it, naming the schema, the JSON
pointer, the keyword and what it changed from and to:

```
schemas/fact.json changed "required" at /allOf/1:
  ["from","key","state","value"] → ["from","key","state","unit","value"].
  bump x-phdude.since, add a migration if an existing workspace needs one,
  then re-record with UPDATE_SNAPSHOT=1
```

Regenerating the snapshot is one command, deliberately not part of any other:

```
UPDATE_SNAPSHOT=1 node --test tests/contracts/schema-stability.test.js
```

Run it only alongside the `since` bump it records. The test also refuses a `since` that moves
while the contract stands still, because that would date a shape to a release it did not change
in.

Objects themselves stay at `version: 1`. The workspace carries the version, not the record, so a
reader asks one question — "is this workspace current?" — rather than one per file.

## Workspace versions and migrations

`phdude.yaml` carries `workspace_version`. Reading an out-of-date workspace works and warns;
writing to one exits 1 and asks for `phdude migrate`. The current version is **5**.

| Version | Shipped in | The migration | What it adds |
|---|---|---|---|
| 1 | 0.1.0 | — | The original workspace. It has no `workspace_version` field, which is how it is recognised. |
| 2 | 0.2.0 | `migrations/0001-workspace-v2.mjs` | `provenance` on claims and evidence, `contradicts` on claims. |
| 3 | 0.5.0 | `migrations/0002-workspace-v3.mjs` | The `execution` block in the research policy, the `analysis/` directories, and the derived-output gitignore rules. |
| 4 | 0.6.0 | `migrations/0003-workspace-v4.mjs` | The venue list in `phdude.yaml` and the empty template registry. |
| 5 | 0.7.0 | `migrations/0004-workspace-v5.mjs` | `reviews/`, the `health.weights` block and the `ready` block in the research policy. |

A migration:

- is idempotent — running it twice changes nothing the second time;
- goes through the `Store` port only, so every write is atomic and every path is the one the rest
  of PhDude uses;
- appends exactly one `migrate` event;
- reports what it would do under `--dry-run` before it does any of it;
- never renames an id. A migration that would re-derive ids is not a migration, it is a new
  workspace.

`tests/fixtures/workspaces/` keeps a v0.1 and a v0.2 workspace, and the migration test upgrades
both to the current version on every run.

## Ports

An extension implements a port and proves it against the contract suite the port itself exports.
Both are stable at 1.0.

| Port | Module | Contract suite |
|---|---|---|
| SearchProvider | `src/ports/search-provider.js` | `searchProviderContract` |
| DocumentParser | `src/ports/document-parser.js` | `documentParserContract` |
| DocumentRenderer | `src/ports/document-renderer.js` | `documentRendererContract` |
| AgentHost | `src/ports/agent-host.js` | `agentHostContract` |
| AnalysisRunner | `src/ports/analysis-runner.js` | `analysisRunnerContract` |

A port may gain an optional capability in a minor release; an implementation that does not
provide it keeps working. A port that starts *requiring* something new is a major change, and the
contract suite is where it becomes visible: the suite is the definition, and the documentation
follows it rather than the other way round.

See [docs/extension-api.md](extension-api.md) for each port's signature and lifecycle, and
[docs/extending.md](extending.md) for where an extension belongs in the first place.

## Skills and packs

A `SKILL.md` declares a `phdude:` block validated against `schemas/skill.json`, at contract
`version: 1`. A skill written for 1.0 loads on every 1.x. New keys arrive optional and default to
least privilege, so a skill that does not mention a permission does not get it.

Packs and venue profiles are data — `schemas/pack.json` and `schemas/profile.json` — and are
frozen the same way as every other schema. A workspace pack with a built-in pack's name overrides
it, and always will.

## Deprecation

Nothing on the public surface disappears without warning.

1. **Deprecate.** The command, flag, field or behaviour keeps working and starts saying it is
   deprecated, naming what replaces it. The CHANGELOG records it under **Deprecated**.
2. **Wait.** At least one minor release, so an upgrade that brings the warning is never the same
   upgrade that breaks the workspace.
3. **Remove.** At the next major only. The CHANGELOG records it under **Removed**, and the entry
   names the replacement again for anyone reading it late.

The one exception is a security fix, which may remove a path immediately. It is announced in
`SECURITY.md` and in the release notes.

## Making a breaking change

1. Write down why, as an ADR in `docs/adr/`.
2. Bump `x-phdude.since` on every schema whose contract moves, and write a migration for every
   existing workspace that needs one.
3. Re-record the snapshot with `UPDATE_SNAPSHOT=1` and read the diff: it is the change, stated
   exactly.
4. Add the CHANGELOG entry under **Breaking**, naming the before and the after, and the command
   that carries a workspace across.
5. Bump MAJOR.

# Contributing to PhDude

Thanks for wanting to help. PhDude is a harness researchers put their work inside, so the bar is
less "does it work" and more "will it still be true in a year". This page says what that means in
practice.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting set up

```
git clone https://github.com/LucioY250/phdude && cd phdude
npm ci
npm link          # puts `phdude` on your PATH, pointing at your checkout
npm test
```

Node 22 or newer, and nothing else. There is no build step, no bundler and no test framework
beyond `node:test`; the whole suite runs in a few seconds. Three runtime dependencies (`yaml`,
`ajv`, `fflate`) and two dev ones (`eslint`, `prettier`).

Some tests want an external tool and skip honestly when it is absent: `pdftotext`
(poppler-utils) for the PDF parser, `pandoc` for the DOCX/PPTX/XLSX renderers, `python3` and
`Rscript` for those analysis runners. `phdude doctor` tells you what your machine has.

Before you push:

```
npm run format
npm run lint
npm test
```

If you touched an example workspace or anything a golden report reads:

```
npm run example:all
UPDATE_GOLDEN=1 node --test tests/golden/*.test.js
git status --porcelain      # explain every line of this in your PR
```

## How a change gets designed

PhDude is built spec-first. Each release has a design spec under
[`docs/superpowers/specs/`](docs/superpowers/specs/) and an implementation plan under
[`docs/superpowers/plans/`](docs/superpowers/plans/), and the code follows them rather than the
other way round. For a bug fix or a small addition you do not need either. For anything that adds
a command, a schema, a port or a policy, open an issue first and let us agree the shape there;
the spec is where the argument happens, and it is much cheaper than a rejected pull request.

The reasoning behind the structural calls already made is in [`docs/adr/`](docs/adr/). If your
change contradicts one, the ADR is the thing to argue with.

## The rules the code follows

These are enforced by tests, so you will meet them either way. Meeting them on purpose is faster.

- **Layering.** `domain` is pure and imports nothing from the rest of the tree. `application`
  imports domain and ports only, never an adapter. Adapters are injected in
  `src/adapters/cli/run.js`. `tests/unit/layering.test.js` scans imports and fails on a violation.
- **The CLI is the only writer.** Skills and agents propose; state changes go through a command.
  One mutating use case appends exactly one event.
- **Every write is atomic and goes through the store.** No `node:fs` in application code.
- **Errors are typed.** `new PhdudeError(code, message, hint, details)`, where the code maps to
  the exit code documented in [`docs/cli.md`](docs/cli.md). Every error carries a hint that names
  a command.
- **No shell.** External tools are called with `execFile` and an argument array.
- **No new runtime dependency** without a very good reason, argued in the pull request.
- **Determinism.** The same inputs produce the same bytes. Clocks, git and the network are
  injected so tests can pin them.
- **No detector surface.** PhDude will not score text for how human it looks, and will not help
  evade a detector. `phdude health --detector` exits 3 on purpose. See
  [`docs/non-goals.md`](docs/non-goals.md).

## Adding a command

A command is not done when it runs. `tests/unit/cli/surface.test.js` checks that every one of
these exists for it:

1. an entry in `COMMAND_OPTIONS` in `src/adapters/cli/args.js` (strict: an unknown flag exits 1);
2. a usage line and a `COMMAND_ROWS` entry in `src/adapters/cli/commands/help.js`;
3. a slash-command template at `commands/<cmd>.md`, with parseable front matter;
4. a row in the README command table;
5. a `### \`phdude <cmd>\`` section in `docs/cli.md`, marked with its stability;
6. tests, written first.

## Extending instead of changing the core

Most additions should not touch the core at all. Parsers, renderers, search providers, agent
hosts, analysis runners, packs and skills all plug in behind documented ports, and every port
ships a contract suite that your implementation runs against:

```js
import test from 'node:test';
import { searchProviderContract } from '../../src/ports/search-provider.js';
import { myProvider } from '../../src/adapters/search/my-provider.js';
searchProviderContract(test, () => myProvider);
```

PhDude loads no JavaScript from outside the package, so a parser, renderer, provider, host or
runner is registered in-tree and arrives by pull request. Packs and skills are the two a workspace
can install on its own. `docs/extension-api.md` is explicit about which is which.

- [`docs/extension-api.md`](docs/extension-api.md) — the seven ports, their lifecycle, their error
  behaviour, their stability, and how to run each contract suite.
- [`docs/extending.md`](docs/extending.md) — the guide: where a change belongs, and how to build
  each kind of extension.
- [`docs/skills-authoring.md`](docs/skills-authoring.md) — SKILL.md, the `phdude:` contract, the
  permission model.
- [`docs/packs-authoring.md`](docs/packs-authoring.md) — field, method and venue packs.
- [`examples/extensions/`](examples/extensions/) — a working third-party provider, parser,
  renderer and pack, each under the contract suites in CI.

## Changing something that is frozen

At 1.0 the schemas, the CLI surface, the exit codes, the `--json` error envelope and the ports
are stable. [`docs/versioning.md`](docs/versioning.md) says exactly what that covers and what it
does not.

A change to a schema's required fields or enums fails `tests/contracts/schema-stability.test.js`
until you bump `x-phdude.since`, write a migration if an existing workspace needs one, and
re-record the snapshot with `UPDATE_SNAPSHOT=1`. That friction is the point: read
[`docs/migration.md`](docs/migration.md) before you decide the change is worth it.

## Tests

Written first, and in the layer that can actually catch the bug:

| Layer                | What lives there                                                            |
| -------------------- | --------------------------------------------------------------------------- |
| `tests/unit/`        | pure functions, argument parsing, schema validation                          |
| `tests/contracts/`   | port contract suites, the schema freeze, the CLI JSON shape                   |
| `tests/integration/` | a use case against a real temporary workspace                                 |
| `tests/golden/`      | committed report output, regenerated with `UPDATE_GOLDEN=1`                   |
| `tests/e2e/`         | the real `bin/phdude.js` against a real workspace                             |
| `tests/live/`        | the network, skipped unless `PHDUDE_LIVE_TESTS=1`                             |

Assert on what landed on disk and on how many events were appended, not only on what a function
returned. No test may reach the network. A test that needs a tool the machine may not have skips
with a message saying which tool, rather than passing quietly.

## Pull requests

Keep one change per pull request, and keep the diff as small as the change actually is. Do not
reformat code you did not otherwise touch.

The template asks you to confirm the things reviewers always end up asking for anyway: tests,
docs, a CHANGELOG entry under `## [Unreleased]`, and that nothing added a detector surface.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat(scope):`, `fix(scope):`, `docs(scope):`, `chore(scope):`, `test(scope):`, `refactor(scope):`.

CI runs format, lint, `npm audit` (advisory), schema and skill validation, the full suite on Node
22 and 24, a Windows subset, `npm pack --dry-run`, and a check that the committed example
workspaces still regenerate byte-for-byte. All of it runs locally too, and much faster.

## Reporting things

- **A bug** — [open a bug report](https://github.com/LucioY250/phdude/issues/new?template=bug.yml).
  The command you ran, what it did, what you expected, and `phdude doctor` output.
- **An idea** — [open a feature request](https://github.com/LucioY250/phdude/issues/new?template=feature.yml).
  Start with the research problem rather than the command you have in mind.
- **A vulnerability** — privately, per [SECURITY.md](SECURITY.md). Never in a public issue.

## Licence

By contributing you agree that your contribution is licensed under the
[MIT Licence](LICENSE), the same as the rest of the project.

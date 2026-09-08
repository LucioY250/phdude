# Example extensions

Four extensions written the way somebody outside this repository would write them. None of them
imports PhDude, none of them has a dependency, and all four are run through the shipped contract
suites by [`tests/contracts/example-extensions.test.js`](../../tests/contracts/example-extensions.test.js)
on every `npm test`. That is the point of them: a port is only an interface if an outsider can
implement it, and the way to prove that is to keep four outsiders in the test run.

| Directory | Port | What it does |
| --- | --- | --- |
| [`search-provider-example/`](search-provider-example/) | `SearchProvider` | Queries a fictional literature API and maps its answers into the `Candidate` shape. |
| [`document-parser-example/`](document-parser-example/) | `DocumentParser` | Reads a plain-text note: first non-empty line is the title, the rest is the body. |
| [`renderer-example/`](renderer-example/) | `DocumentRenderer` | Renders the assembled manuscript to plain text by stripping Markdown. |
| [`pack-example/`](pack-example/) | `ResearchPack` + `ResearchSkill` | A field pack carrying vocabulary, reviewers, checks and one skill. Data only. |

Run their contract suites:

```
node --test tests/contracts/example-extensions.test.js
```

The reference for every port — signatures, lifecycle, error codes, stability and how each one is
registered today — is [`docs/extension-api.md`](../../docs/extension-api.md).

## What "third-party" means here

Three of the four are JavaScript, and PhDude does not load JavaScript from outside the package:
there is no plugin loader, and adding a provider, a parser or a renderer to a build means
registering it in the package's own registry. So these three examples are what you would write
before opening a pull request, or in a fork. The contract suite is what makes either safe.

The fourth is different. A pack and a skill are data, not code, and a workspace installs both
without touching the package — `.phdude/packs/<kind>/<name>/` and `phdude skills install`. See
[`docs/packs-authoring.md`](../../docs/packs-authoring.md) and
[`docs/skills-authoring.md`](../../docs/skills-authoring.md).

## Licence

MIT, the same as PhDude. Each file carries an `SPDX-License-Identifier: MIT` header; copy any of
them into your own project and keep the header or replace it with your own notice.

These directories are not published: they are not in `package.json`'s `files`, and each one's own
`package.json` is marked `private`.

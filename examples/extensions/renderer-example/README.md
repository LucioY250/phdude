# renderer-example

A third-party [`DocumentRenderer`](../../../docs/extension-api.md#documentrenderer). It renders
the assembled manuscript to plain text by stripping Markdown, and declares one format, `txt`.

```js
import { exampleRenderer } from './index.js';

await exampleRenderer.render({
  input: { markdownPath: 'outputs/thesis/manuscript.md', metadata: { title: 'A thesis' } },
  output: { path: 'outputs/thesis/manuscript.txt', format: 'txt' },
  cwd: process.cwd(),
});
```

## What it demonstrates

- **Validation before availability.** A format the renderer does not declare, or an input file
  nobody wrote, is a `VALIDATION` error on every machine. Answering `TOOL_MISSING` over a typo
  would send a researcher off to install a tool they do not need. This renderer has no tool to be
  missing, so the second step is empty here; a renderer wrapping one probes it next and refuses
  with `TOOL_MISSING` carrying the install hint.
- **`available()` names its version.** An available renderer says what produced the bytes, so a
  build can record it; an unavailable one says what would install it.
- **The renderer creates its own output directory.** A build writes into `outputs/<slug>/`, and a
  renderer that made every caller `mkdir` first would push that on all of them.
- **An input it cannot honour is a warning naming the file**, never a silent drop. This one has
  no bibliography, CSL, reference-document or template support, and says so per file.
- **Deterministic.** No clock, no random ids, nothing fetched at render time. The same manuscript
  and the same metadata always produce the same bytes — including the `date` the caller passes,
  which is why the build passes one rather than letting a tool reach for the clock.

## Running its contract suite

```
node --test tests/contracts/example-extensions.test.js
```

The suite checks byte-for-byte reproducibility only for `md`, `latex` and `html`, so `txt` is not
held to it automatically. This renderer is reproducible anyway, and a renderer of one of those
three formats has to be.

MIT licensed. Nothing here imports PhDude.

# document-parser-example

A third-party [`DocumentParser`](../../../docs/extension-api.md#documentparser). It reads a
plain-text note: the first non-empty line is the title, everything after it is the body, and the
pair becomes one section.

```js
import { exampleParser } from './index.js';

const result = await exampleParser.parse(await readFile('notes.txt'), { path: 'notes.txt' });
// → { text, sections: [{ title, text }], tables: [], meta, warnings }
```

## What it demonstrates

- **Pure and idempotent.** The same bytes always yield the same result. The contract suite parses
  each fixture twice and compares the two with `deepEqual`, so anything that reads a clock, a
  counter or the filesystem fails it.
- **An empty buffer is a document with nothing in it**, not an error. Ingestion still inventories
  and hashes the artifact; what the parser could not read becomes a warning.
- **`available()` is honest.** This parser needs no external tool, so it always returns `true`. A
  parser that shells out to one probes it here, and ingestion degrades to a warning instead of
  failing when the probe comes back false.
- **`meta` is the parser's own vocabulary.** PhDude passes it through and never branches on it.

## Fixtures

`fixtures/notes.txt` is what the contract run parses.

## Running its contract suite

```
node --test tests/contracts/example-extensions.test.js
```

MIT licensed. Nothing here imports PhDude.

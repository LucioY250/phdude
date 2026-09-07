import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { next } from '../../src/application/next.js';
import { renderNext } from '../../src/adapters/cli/output.js';

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(here, '..', '..', 'examples', 'generic-thesis');
// A fixed present, so a report that reads the calendar - how long ago a question was last
// searched - renders the same today and in a year.
const FIXED_NOW = () => '2026-09-07T12:00:00Z';
const GOLDEN = join(here, 'expected', 'next.txt');

test('next golden: examples/generic-thesis renders exactly like tests/golden/expected/next.txt', async () => {
  const store = new FsStore(WORKSPACE);
  const result = await next({ store, clock: FIXED_NOW });
  const text = renderNext(result);

  if (process.env.UPDATE_GOLDEN) {
    await writeFile(GOLDEN, text);
    return;
  }

  const expected = await readFile(GOLDEN, 'utf8');
  assert.equal(text, expected);
});

test('next golden: the top action is open-conflicts on sample_size, counting the claims that rest on it', async () => {
  const store = new FsStore(WORKSPACE);
  const result = await next({ store, clock: FIXED_NOW });

  assert.equal(result.top.rule, 'open-conflicts');
  assert.match(result.top.action, /sample_size/);
  assert.equal(
    result.top.dependents,
    3,
    'the claims supported by evidence citing Survey Alpha or Survey Beta, and nothing else',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { freshness } from '../../src/application/freshness.js';
import { renderFreshness } from '../../src/adapters/cli/output.js';

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(here, '..', '..', 'examples', 'generic-thesis');
// A fixed present, so ages measured in days and years render the same today and in a year.
const FIXED_NOW = () => '2026-09-07T12:00:00Z';
const GOLDEN = join(here, 'expected', 'freshness.txt');

test('freshness golden: examples/generic-thesis renders exactly like tests/golden/expected/freshness.txt', async () => {
  const store = new FsStore(WORKSPACE);
  const report = await freshness({ store, clock: FIXED_NOW });
  const text = renderFreshness(report);

  if (process.env.UPDATE_GOLDEN) {
    await writeFile(GOLDEN, text);
    return;
  }

  const expected = await readFile(GOLDEN, 'utf8');
  assert.equal(text, expected);
});

// The example carries one search recorded a year before everything else, so the report has to
// show all three shapes at once: a question searched but stale, and questions never searched.
test('freshness golden: the example covers stale, never-searched and aged sources', async () => {
  const store = new FsStore(WORKSPACE);
  const report = await freshness({ store, clock: FIXED_NOW });

  const searched = report.questions.filter((q) => q.lastSearch !== null);
  assert.equal(searched.length, 1, 'exactly one question has been searched');
  assert.equal(searched[0].stale, true, 'and that search has gone stale');
  assert.equal(report.summary.neverSearched, report.questions.length - 1);
  assert.ok(report.summary.medianAge > 0, 'the example records sources with a year');
});

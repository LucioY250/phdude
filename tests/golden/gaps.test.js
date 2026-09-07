import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { gaps } from '../../src/application/gaps.js';
import { renderGaps } from '../../src/adapters/cli/output.js';

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(here, '..', '..', 'examples', 'generic-thesis');
// A fixed present, so a report that reads the calendar - how long ago a question was last
// searched - renders the same today and in a year.
const FIXED_NOW = () => '2026-09-07T12:00:00Z';
const GOLDEN = join(here, 'expected', 'gaps.txt');

test('gaps golden: examples/generic-thesis renders exactly like tests/golden/expected/gaps.txt', async () => {
  const store = new FsStore(WORKSPACE);
  const report = await gaps({ store, clock: FIXED_NOW });
  const text = renderGaps(report);

  if (process.env.UPDATE_GOLDEN) {
    await writeFile(GOLDEN, text);
    return;
  }

  const expected = await readFile(GOLDEN, 'utf8');
  assert.equal(text, expected);
});

// The example is generated (scripts/make-example.mjs) to reach every gap kind the report can
// produce, so the golden above is a worked example of each rather than a sample of a few.
test('gaps golden: every gap kind appears on the example', async () => {
  const store = new FsStore(WORKSPACE);
  const report = await gaps({ store, clock: FIXED_NOW });
  const kinds = [...new Set(report.gaps.map((g) => g.kind))].sort();
  assert.deepEqual(kinds, [
    'artifact-unmined',
    'claim-weak-evidence',
    'claim-without-evidence',
    'disputed-pair',
    'hypothesis-untested',
    'open-conflict',
    'question-never-searched',
    'question-only-candidates',
    'question-without-claims',
    'question-without-method',
    'stale-search',
    'uncited-source',
  ]);
});

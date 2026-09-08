import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { compute } from '../../src/application/health.js';
import { renderHealth } from '../../src/adapters/cli/output.js';

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(here, '..', '..', 'examples', 'generic-thesis');
// A fixed present: Freshness and Literature Coverage both count stale searches in days.
const FIXED_NOW = () => '2026-09-07T12:00:00Z';
const GOLDEN = join(here, 'expected', 'health.txt');

const actor = { researcher: 'golden', agent: 'node' };

test('health golden: examples/generic-thesis renders exactly like tests/golden/expected/health.txt', async () => {
  const store = new FsStore(WORKSPACE);
  const report = await compute({ store, clock: FIXED_NOW, actor });
  const text = renderHealth(report);

  if (process.env.UPDATE_GOLDEN) {
    await writeFile(GOLDEN, text);
    return;
  }

  const expected = await readFile(GOLDEN, 'utf8');
  assert.equal(text, expected);
});

// The example is a finished workspace - questions, claims, evidence, a stale search, an
// analysis and an approved section - so every one of the eight dimensions has something to
// score, and the golden above is the worked example of each formula.
test('health golden: the example scores every dimension and leaves none unexplained', async () => {
  const store = new FsStore(WORKSPACE);
  const report = await compute({ store, clock: FIXED_NOW, actor });

  assert.equal(report.dimensions.length, 8);
  assert.ok(report.overall > 0 && report.overall <= 100);
  for (const dimension of report.dimensions) {
    assert.ok(dimension.observations.length > 0, `${dimension.key} explains nothing`);
    if (dimension.score === null) continue;
    assert.ok(dimension.score >= 0 && dimension.score <= 100, `${dimension.key} out of bounds`);
  }
  assert.equal(report.saved, null, 'the golden run must not write into the example');
});

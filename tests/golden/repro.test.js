import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { check } from '../../src/application/repro.js';
import { renderRepro } from '../../src/adapters/cli/output.js';

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(here, '..', '..', 'examples', 'generic-thesis');
const GOLDEN = join(here, 'expected', 'repro.txt');

test('repro golden: examples/generic-thesis renders exactly like tests/golden/expected/repro.txt', async () => {
  const store = new FsStore(WORKSPACE);
  const text = renderRepro(await check({ store }));

  if (process.env.UPDATE_GOLDEN) {
    await writeFile(GOLDEN, text);
    return;
  }

  const expected = await readFile(GOLDEN, 'utf8');
  assert.equal(text, expected);
});

// The example ships the files its analysis, table and figure produced, so a fresh checkout can
// see a finished workspace rather than one that needs a run before it says anything. Nothing in
// it is stale, which is the state `phdude repro check` exists to confirm.
test('repro golden: the example has nothing to re-run or rebuild', async () => {
  const store = new FsStore(WORKSPACE);
  const report = await check({ store });

  assert.equal(report.attention, 0);
  assert.equal(report.counts['up-to-date'], 3);
  assert.deepEqual(
    report.items.map((item) => item.kind),
    ['analysis', 'table', 'figure'],
  );
  for (const item of report.items) assert.deepEqual(item.reasons, []);
});

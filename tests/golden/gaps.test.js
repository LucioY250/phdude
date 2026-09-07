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
const GOLDEN = join(here, 'expected', 'gaps.txt');

test('gaps golden: examples/generic-thesis renders exactly like tests/golden/expected/gaps.txt', async () => {
  const store = new FsStore(WORKSPACE);
  const report = await gaps({ store });
  const text = renderGaps(report);

  if (process.env.UPDATE_GOLDEN) {
    await writeFile(GOLDEN, text);
    return;
  }

  const expected = await readFile(GOLDEN, 'utf8');
  assert.equal(text, expected);
});

test('gaps golden: several gap kinds appear on the example', async () => {
  const store = new FsStore(WORKSPACE);
  const report = await gaps({ store });
  const kinds = new Set(report.gaps.map((g) => g.kind));
  assert.ok(
    kinds.size >= 3,
    `expected at least 3 distinct gap kinds, got: ${[...kinds].join(', ')}`,
  );
});

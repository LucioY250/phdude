import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { matrix } from '../../src/application/matrix.js';
import { renderMatrix } from '../../src/adapters/cli/output.js';

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(here, '..', '..', 'examples', 'generic-thesis');
const GOLDEN = join(here, 'expected', 'matrix.md');

test('matrix golden: examples/generic-thesis renders exactly like tests/golden/expected/matrix.md', async () => {
  const store = new FsStore(WORKSPACE);
  const result = await matrix({ store }, {});
  const text = renderMatrix(result.rows, result.format);

  if (process.env.UPDATE_GOLDEN) {
    await writeFile(GOLDEN, text);
    return;
  }

  const expected = await readFile(GOLDEN, 'utf8');
  assert.equal(text, expected);
});

test('matrix golden: at least one row has no questions (cited but never used in a claim)', async () => {
  const store = new FsStore(WORKSPACE);
  const result = await matrix({ store }, {});
  assert.ok(result.rows.some((r) => r.questions.length === 0));
  assert.ok(result.rows.some((r) => r.questions.length > 0));
});

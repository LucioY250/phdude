import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { status } from '../../src/application/status.js';
import { renderStatus } from '../../src/adapters/cli/output.js';

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(here, '..', '..', 'examples', 'generic-thesis');
const GOLDEN = join(here, 'expected', 'status.txt');

test('status golden: examples/generic-thesis renders exactly like tests/golden/expected/status.txt', async () => {
  const store = new FsStore(WORKSPACE);
  const report = await status({ store });
  const text = renderStatus(report);

  if (process.env.UPDATE_GOLDEN) {
    await writeFile(GOLDEN, text);
    return;
  }

  const expected = await readFile(GOLDEN, 'utf8');
  assert.equal(text, expected);
});

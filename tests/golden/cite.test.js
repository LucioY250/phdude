import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { exportRegistry } from '../../src/application/cite.js';

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(here, '..', '..', 'examples', 'generic-thesis');
const GOLDEN = join(here, 'expected', 'references.bib');

// `references.bib` is a derived export, not part of the committed example workspace (spec
// S3.3: the registry is derived, never canonical) - so it is exported into a throwaway copy
// of the example rather than into examples/generic-thesis itself.
test('cite export golden: examples/generic-thesis exports exactly like tests/golden/expected/references.bib', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-cite-golden-'));
  try {
    await cp(WORKSPACE, root, { recursive: true });
    const store = new FsStore(root);
    const { path } = await exportRegistry({ store, format: 'bibtex' });
    const text = await readFile(path, 'utf8');

    if (process.env.UPDATE_GOLDEN) {
      await writeFile(GOLDEN, text);
      return;
    }

    const expected = await readFile(GOLDEN, 'utf8');
    assert.equal(text, expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

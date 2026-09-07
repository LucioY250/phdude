import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../../scripts/make-example.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const COMMITTED = join(here, '..', '..', 'examples', 'generic-thesis');

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}

async function snapshotTree(root) {
  const files = await listFiles(root);
  const rel = files.map((f) => f.slice(root.length + 1)).sort();
  const contents = {};
  for (const r of rel) contents[r] = await readFile(join(root, r), 'utf8');
  return { rel, contents };
}

test('make-example: regenerating twice into a fresh directory produces byte-identical files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-example-'));
  try {
    await generate(root);
    const first = await snapshotTree(root);

    await generate(root);
    const second = await snapshotTree(root);

    assert.deepEqual(second.rel, first.rel);
    for (const r of first.rel) {
      assert.equal(second.contents[r], first.contents[r], `${r} differs between runs`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('make-example: a freshly generated workspace matches the committed examples/generic-thesis', async () => {
  await stat(COMMITTED); // fails loudly if the example was never committed
  const root = await mkdtemp(join(tmpdir(), 'phdude-example-'));
  try {
    await generate(root);
    const generated = await snapshotTree(root);
    const committed = await snapshotTree(COMMITTED);

    // .phdude/cache/ is gitignored by the workspace's own .gitignore, so it is regenerated
    // locally but never committed; everything else must match exactly.
    const committedTracked = committed.rel.filter((r) => !r.startsWith('.phdude/cache/'));
    const generatedTracked = generated.rel.filter((r) => !r.startsWith('.phdude/cache/'));

    assert.deepEqual(generatedTracked, committedTracked);
    for (const r of generatedTracked) {
      assert.equal(generated.contents[r], committed.contents[r], `${r} differs from committed`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

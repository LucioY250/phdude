import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpath } from '../../../src/adapters/store/fs-walk.js';
import { assertPathsInsideRoot } from '../../../src/application/paths.js';

const HINT = 'stay inside the workspace';

async function newRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-paths-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('a directory whose name begins with two dots is inside the workspace', async (t) => {
  const root = await newRoot(t);
  await mkdir(join(root, '..hidden'), { recursive: true });
  await writeFile(join(root, '..hidden', 'notes.md'), '# notes\n');

  await assertPathsInsideRoot({ realpath }, root, ['..hidden/notes.md'], HINT);
});

test('a link whose real path leaves the workspace is refused', async (t) => {
  const root = await newRoot(t);
  const outside = await newRoot(t);
  await writeFile(join(outside, 'secret.txt'), 'x');
  await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'));

  await assert.rejects(
    assertPathsInsideRoot({ realpath }, root, ['link.txt'], HINT),
    (err) => err.code === 'USAGE' && err.hint === HINT,
  );
});

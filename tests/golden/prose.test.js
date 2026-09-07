import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { proseSection } from '../../src/application/prose.js';
import { renderProse } from '../../src/adapters/cli/output.js';

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(here, '..', '..', 'examples', 'generic-thesis');
const FIXED_NOW = () => '2026-09-07T12:00:00Z';
const GOLDEN = join(here, 'expected', 'prose-introduction.txt');

// `prose <section>` stores the scores it computed in `manuscript/reports/<section>.yaml`, so it
// runs against a throwaway copy of the example rather than writing into the committed one -
// the same reason `cite.test.js` copies before exporting.
test('prose golden: `phdude prose introduction` renders exactly like tests/golden/expected/prose-introduction.txt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-prose-golden-'));
  try {
    await cp(WORKSPACE, root, { recursive: true });
    const result = await proseSection(
      { store: new FsStore(root), clock: FIXED_NOW },
      'introduction',
    );
    const text = `${result.section.id} (${result.section.status})  ${result.section.title}\n\n${renderProse(result)}`;

    if (process.env.UPDATE_GOLDEN) {
      await writeFile(GOLDEN, text);
      return;
    }

    assert.equal(text, await readFile(GOLDEN, 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('prose golden: re-running the report over unchanged prose moves nothing but the clock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-prose-golden-'));
  try {
    await cp(WORKSPACE, root, { recursive: true });
    const store = new FsStore(root);
    const before = await store.readReport('introduction');
    await proseSection({ store, clock: FIXED_NOW }, 'introduction');
    const after = await store.readReport('introduction');

    // `prose` recomputes the whole record rather than merging scores onto the last one, and the
    // gates it runs are the ones `submit` ran over the same body: only the timestamp moves.
    assert.equal(after.at, FIXED_NOW());
    assert.notEqual(after.at, before.at);
    assert.deepEqual({ ...after, at: null }, { ...before, at: null });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('prose golden: the rendered report shows every voice finding the stored report counted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-prose-golden-'));
  try {
    await cp(WORKSPACE, root, { recursive: true });
    const store = new FsStore(root);
    const stored = await store.readReport('introduction');
    const counted = stored.gates.find((row) => row.gate === 'gate-voice').findings;
    const result = await proseSection({ store, clock: FIXED_NOW }, 'introduction');

    // The screen and `manuscript/reports/introduction.yaml` report the same number of voice
    // findings: a warning the file counts is a warning the report prints.
    assert.equal(result.voice.length, counted);
    assert.match(renderProse(result), new RegExp(`^Voice \\(${counted}\\):$`, 'm'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

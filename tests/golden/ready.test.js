import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { loadProfile } from '../../src/adapters/packs/loader.js';
import { check } from '../../src/application/ready.js';
import { renderReady } from '../../src/adapters/cli/output.js';

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(here, '..', '..', 'examples', 'generic-thesis');
// A fixed present: Research Health and the gap report both count stale searches in days.
const FIXED_NOW = () => '2026-09-07T12:00:00Z';
const GOLDEN = join(here, 'expected', 'ready.txt');

const deps = () => ({ store: new FsStore(WORKSPACE), clock: FIXED_NOW, loadProfile });

test('ready golden: examples/generic-thesis renders exactly like tests/golden/expected/ready.txt', async () => {
  const text = renderReady(await check(deps()));

  if (process.env.UPDATE_GOLDEN) {
    await writeFile(GOLDEN, text);
    return;
  }

  assert.equal(text, await readFile(GOLDEN, 'utf8'));
});

// The example is a workspace in the middle of the work, not a finished submission, so the
// verdict is `not ready` and every requirement the policy lists has something to say about it.
test('ready golden: the example is not ready, and every blocking item names a command', async () => {
  const report = await check(deps());

  assert.equal(report.ready, false);
  assert.equal(report.profile, 'generic-thesis');
  assert.equal(report.mode, 'full');
  assert.ok(report.blocking.length > 0);
  for (const item of report.blocking) assert.match(item.command, /^phdude /);
  // A `major` review is not a blocking one until the mode is `ruthless`.
  assert.equal(
    report.checks.find((entry) => entry.code === 'no-block-reviews').ok,
    true,
    'the example review blocks under full mode',
  );
});

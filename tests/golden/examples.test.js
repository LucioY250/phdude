import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { loadProfile } from '../../src/adapters/packs/loader.js';
import { status } from '../../src/application/status.js';
import { next } from '../../src/application/next.js';
import { gaps } from '../../src/application/gaps.js';
import { compute as health } from '../../src/application/health.js';
import { check as ready } from '../../src/application/ready.js';
import {
  renderStatus,
  renderNext,
  renderGaps,
  renderHealth,
  renderReady,
} from '../../src/adapters/cli/output.js';
import { PROFILES } from '../../scripts/make-examples.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..', '..');
// A fixed present, so a report that reads the calendar - how long ago a question was last
// searched - renders the same today and in a year.
const FIXED_NOW = () => '2026-09-07T12:00:00Z';
const actor = { researcher: 'golden', agent: 'node' };

// The five reports a reader opens an example workspace to see: where it stands, what to do next,
// what is missing, how healthy it is, and whether it could be submitted.
const REPORTS = [
  ['status', (deps) => status(deps), renderStatus],
  ['next', (deps) => next(deps), renderNext],
  ['gaps', (deps) => gaps(deps), renderGaps],
  ['health', (deps) => health(deps), renderHealth],
  ['ready', (deps) => ready(deps), renderReady],
];

for (const profile of PROFILES) {
  for (const [name, run, render] of REPORTS) {
    test(`${profile.name} golden: ${name} renders exactly like expected/${profile.name}/${name}.txt`, async () => {
      const store = new FsStore(join(REPO_ROOT, 'examples', profile.name));
      const text = render(await run({ store, clock: FIXED_NOW, actor, loadProfile }));
      const golden = join(here, 'expected', profile.name, `${name}.txt`);

      if (process.env.UPDATE_GOLDEN) {
        await mkdir(dirname(golden), { recursive: true });
        await writeFile(golden, text);
        return;
      }

      assert.equal(text, await readFile(golden, 'utf8'));
    });
  }

  // The examples exist to prove field agnosticism (spec §2.3), which they only do if every
  // report the core produces has something to say about each of them.
  test(`${profile.name} golden: health scores every dimension and ready names its venue`, async () => {
    const store = new FsStore(join(REPO_ROOT, 'examples', profile.name));

    const report = await health({ store, clock: FIXED_NOW, actor });
    assert.equal(report.dimensions.length, 8);
    assert.equal(report.saved, null, 'the golden run must not write into the example');
    for (const dimension of report.dimensions) {
      assert.ok(dimension.observations.length > 0, `${dimension.key} explains nothing`);
    }

    const verdict = await ready({ store, clock: FIXED_NOW, loadProfile });
    assert.equal(typeof verdict.ready, 'boolean');
    assert.equal(verdict.profile, profile.venue);
    for (const item of verdict.blocking) assert.match(item.command, /^phdude /);
  });
}

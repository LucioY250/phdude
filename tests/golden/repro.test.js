import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { check as figureCheck } from '../../src/application/figure.js';
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

// `phdude figure check` reports the figure rows of the same report, so the two commands cannot
// disagree about a figure. Checked on the committed example and again on a scratch copy of it
// whose dataset has been edited, which is the state they used to disagree in: `repro check` saw
// the analysis behind the figure's result go stale, and `figure check` did not.
test('repro golden: figure check reports exactly what repro check reports for a figure', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'phdude-agree-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  await cp(WORKSPACE, scratch, { recursive: true });
  const store = new FsStore(scratch);

  const agree = async (where) => {
    const items = (await check({ store })).items.filter((item) => item.kind === 'figure');
    const { figures } = await figureCheck({ store });
    assert.deepEqual(figures, items, where);
    assert.ok(figures.length > 0, 'the example declares a figure');
    return figures;
  };

  for (const item of await agree('the committed example')) assert.equal(item.status, 'up-to-date');

  await appendFile(join(scratch, 'data', 'survey.csv'), '21,mailing list,yes,7\n');
  for (const item of await agree('after the dataset was edited')) {
    assert.equal(item.status, 'stale');
    assert.equal(item.reasons[0].kind, 'upstream-stale');
  }
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

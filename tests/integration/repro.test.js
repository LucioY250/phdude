import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { localRunner } from '../../src/adapters/execution/local.js';
import { DEFAULT_GENERATORS_DIR } from '../../src/adapters/execution/generators.js';
import { parseTable } from '../../src/adapters/documents/index.js';
import { read, realpath } from '../../src/adapters/store/fs-walk.js';
import { CURRENT_WORKSPACE_VERSION } from '../../src/domain/versioning.js';
import * as analyze from '../../src/application/analyze.js';
import * as data from '../../src/application/data.js';
import * as figure from '../../src/application/figure.js';
import * as repro from '../../src/application/repro.js';
import * as table from '../../src/application/table.js';
import { loadSnapshot } from '../../src/application/snapshot.js';
import { recommendNext } from '../../src/domain/next.js';

const actor = { researcher: 'test', agent: 'node' };

const SURVEY = ['id,channel,daily', '1,list,yes', '2,list,no', '3,social,yes'].join('\n') + '\n';
const EDITED = SURVEY + '4,social,no\n';

// A deterministic analysis: it counts the rows it was given and reports the share that answered
// yes, so editing the csv is guaranteed to change what it writes.
const SCRIPT = `import { readFile, mkdir, writeFile } from 'node:fs/promises';
const rows = (await readFile('data/survey.csv', 'utf8')).trim().split('\\n').slice(1);
const yes = rows.filter((r) => r.endsWith('yes')).length;
await mkdir('analysis/out/counts', { recursive: true });
await writeFile(
  'analysis/out/counts/results.json',
  JSON.stringify({
    results: [
      {
        key: 'daily_use',
        summary: 'Most respondents report daily use.',
        values: { yes, no: rows.length - yes },
        unit: 'respondents',
      },
    ],
  }),
);
`;

function makeDeps(root) {
  let tick = 0;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 8, 7, 10, 0, tick++)).toISOString(),
    actor,
    runner: localRunner,
    readBytes: (rel) => read(join(root, rel)),
    realpath,
    parseTable,
    generatorsDir: DEFAULT_GENERATORS_DIR,
  };
}

async function newRoot() {
  const root = await mkdtemp(join(tmpdir(), 'phdude-repro-'));
  await mkdir(join(root, '.phdude'), { recursive: true });
  await mkdir(join(root, 'data'), { recursive: true });
  await mkdir(join(root, 'analysis'), { recursive: true });
  await writeFile(
    join(root, 'phdude.yaml'),
    [
      'schema: phdude.project',
      'version: 1',
      `workspace_version: ${CURRENT_WORKSPACE_VERSION}`,
      'title: Repro test',
      'language: en',
      'fields: []',
      'methods: []',
      'outputs: [thesis]',
      'mode: full',
      'agents: [claude-code]',
    ].join('\n') + '\n',
  );
  await writeFile(
    join(root, '.phdude', 'research-policy.yaml'),
    ['execution:', '  enabled: true', '  timeout_seconds: 60', ''].join('\n'),
  );
  await writeFile(join(root, 'data', 'survey.csv'), SURVEY);
  await writeFile(join(root, 'analysis', 'counts.mjs'), SCRIPT);
  return root;
}

// The whole v0.5 flow, once: register the data, declare and run the analysis, render the result
// as a table and draw it as a figure. Every test below starts from here, because staleness is
// only meaningful against something that was actually produced.
async function buildEverything(deps) {
  const { dataset } = await data.add(deps, 'data/survey.csv');
  const { analysis } = await analyze.add(deps, {
    name: 'counts',
    runtime: 'node',
    script: 'analysis/counts.mjs',
    inputs: [dataset.id],
    outputs: { results: 'analysis/out/counts/results.json' },
  });
  const run = await analyze.run(deps, { id: analysis.id });
  const result = run.created[0];

  const declaredTable = await table.add(deps, {
    name: 'daily-use',
    caption: 'Daily use.',
    source: { result: result.id },
    formats: ['md'],
  });
  await table.build(deps, declaredTable.table.id);

  const declaredFigure = await figure.add(deps, {
    name: 'daily-use',
    caption: 'Daily use.',
    alt: 'A bar chart of the yes and no counts.',
    generator: {
      runtime: 'node',
      script: 'phdude:bar-chart',
      args: [
        '--input',
        'analysis/out/counts/results.json',
        '--key',
        'daily_use',
        '--out',
        'figures/out/daily-use.svg',
        '--title',
        'Daily use',
        '--alt',
        'A bar chart of the yes and no counts.',
      ],
    },
    inputs: [result.id],
    outputs: [{ path: 'figures/out/daily-use.svg', format: 'svg' }],
  });
  await figure.build(deps, declaredFigure.figure.id);

  return {
    dataset,
    analysis,
    result,
    table: declaredTable.table,
    figure: declaredFigure.figure,
  };
}

const byId = (report) => Object.fromEntries(report.items.map((item) => [item.id, item]));

test('check reports every declared analysis, table and figure as up to date after a full build', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const built = await buildEverything(deps);

  const report = await repro.check(deps);

  assert.equal(report.items.length, 3);
  assert.equal(report.attention, 0);
  assert.deepEqual(report.counts, {
    'up-to-date': 3,
    stale: 0,
    'never-run': 0,
    'missing-output': 0,
  });
  assert.deepEqual(
    report.items.map((item) => item.kind),
    ['analysis', 'table', 'figure'],
  );
  assert.deepEqual(byId(report)[built.analysis.id].reasons, []);
});

test('check reports what has been declared and never produced', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);

  const { dataset } = await data.add(deps, 'data/survey.csv');
  const { analysis } = await analyze.add(deps, {
    name: 'counts',
    script: 'analysis/counts.mjs',
    inputs: [dataset.id],
    outputs: { results: 'analysis/out/counts/results.json' },
  });

  const report = await repro.check(deps);
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0].id, analysis.id);
  assert.equal(report.items[0].status, 'never-run');
  assert.equal(report.attention, 1);
});

// The spec's success condition, verbatim: one edit to the csv, and the report says the analysis,
// the table *and* the figure are stale - then registering the file, pointing the analysis at the
// new dataset and re-running clears the analysis and leaves the two downstream rebuilds.
test('editing the dataset file makes the analysis, the table and the figure stale', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const built = await buildEverything(deps);

  await writeFile(join(root, 'data', 'survey.csv'), EDITED);
  const items = byId(await repro.check(deps));

  assert.equal(items[built.analysis.id].status, 'stale');
  assert.deepEqual(
    items[built.analysis.id].reasons.map((r) => r.kind),
    ['unregistered-input'],
  );
  assert.equal(items[built.analysis.id].reasons[0].registered, built.dataset.hash);

  // The table and the figure read a RESULT the analysis has not re-written yet. The numbers in
  // them are no longer the numbers the data supports, so they are stale by that hop.
  for (const id of [built.table.id, built.figure.id]) {
    assert.equal(items[id].status, 'stale', id);
    assert.deepEqual(items[id].reasons, [
      {
        kind: 'upstream-stale',
        input: built.result.id,
        analysis: built.analysis.id,
        status: 'stale',
      },
    ]);
  }

  const registered = await data.add(deps, 'data/survey.csv');
  assert.notEqual(registered.dataset.id, built.dataset.id);
  await analyze.add(deps, {
    name: 'counts',
    runtime: 'node',
    script: 'analysis/counts.mjs',
    inputs: [registered.dataset.id],
    outputs: { results: 'analysis/out/counts/results.json' },
  });
  await analyze.run(deps, { id: built.analysis.id });

  const after = byId(await repro.check(deps));
  assert.equal(after[built.analysis.id].status, 'up-to-date');
  assert.equal(after[built.table.id].status, 'stale');
  assert.equal(after[built.figure.id].status, 'stale');
});

// `analyze run` records the DATASET record's hash, so a file edited without `phdude data add`
// cannot be run against: the run would write down bytes it did not read. The sequence `next`
// hands the researcher is followed here exactly as printed, and it terminates.
test('the sequence next recommends for a drifted input clears it, and does not loop', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const built = await buildEverything(deps);

  await writeFile(join(root, 'data', 'survey.csv'), EDITED);
  await assert.rejects(analyze.run(deps, { id: built.analysis.id }), { code: 'VALIDATION' });

  const snapshot = await loadSnapshot(deps.store, deps.clock);
  const action = recommendNext(snapshot, []).find((a) => a.rule === 'analysis-stale');
  const steps = action.command.split(', then ');
  assert.equal(steps.length, 3);

  // Step one, as printed: `phdude data add data/survey.csv`.
  assert.equal(steps[0], 'phdude data add data/survey.csv');
  const registered = await data.add(deps, 'data/survey.csv');

  // Step two, as printed: the declaration it names is re-declared verbatim, and the id it
  // predicted for the file's new bytes is the id `data add` actually minted.
  const declaration = JSON.parse(
    steps[1].replace(/^phdude analyze add --json '/, '').replace(/'$/, ''),
  );
  assert.deepEqual(declaration.inputs, [registered.dataset.id]);
  await analyze.add(deps, declaration);

  // Step three, as printed.
  assert.equal(steps[2], `phdude analyze run ${built.analysis.id}`);
  const rerun = await analyze.run(deps, { id: built.analysis.id });
  assert.equal(rerun.ran, true);

  const items = byId(await repro.check(deps));
  assert.equal(items[built.analysis.id].status, 'up-to-date');
  const after = recommendNext(await loadSnapshot(deps.store, deps.clock), []);
  assert.equal(
    after.some((a) => a.rule === 'analysis-stale'),
    false,
    'the recommendation is gone, so following it terminates',
  );
});

test('check reports a declared output that has been deleted', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const built = await buildEverything(deps);

  await rm(join(root, 'figures', 'out', 'daily-use.svg'));
  await rm(join(root, 'tables', 'out', 'daily-use.md'));

  const items = byId(await repro.check(deps));
  assert.equal(items[built.figure.id].status, 'missing-output');
  assert.deepEqual(items[built.figure.id].reasons, [
    { kind: 'missing-output', path: 'figures/out/daily-use.svg' },
  ]);
  assert.equal(items[built.table.id].status, 'missing-output');
});

// The reading `figure check` cannot reach on its own: the figure is current against the file,
// and the DATASET it says it came from describes bytes that are no longer in it.
test('check reports a figure rebuilt from bytes the registered dataset no longer describes', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);

  const { dataset } = await data.add(deps, 'data/survey.csv');
  const declared = await figure.add(deps, {
    name: 'channels',
    caption: 'Respondents per channel.',
    alt: 'A bar chart of respondents per recruitment channel.',
    generator: {
      runtime: 'node',
      script: 'phdude:bar-chart',
      args: [
        '--input',
        'data/survey.csv',
        '--key',
        'channel',
        '--out',
        'figures/out/channels.svg',
        '--title',
        'Respondents per channel',
        '--alt',
        'A bar chart of respondents per recruitment channel.',
      ],
    },
    inputs: [dataset.id],
    outputs: [{ path: 'figures/out/channels.svg', format: 'svg' }],
  });

  await writeFile(join(root, 'data', 'survey.csv'), EDITED);
  await figure.build(deps, declared.figure.id);

  const items = byId(await repro.check(deps));
  assert.equal(items[declared.figure.id].status, 'stale');
  assert.deepEqual(
    items[declared.figure.id].reasons.map((r) => r.kind),
    ['unregistered-input'],
  );
  assert.equal(items[declared.figure.id].reasons[0].registered, dataset.hash);
});

test('check exits nothing and writes nothing: no event is appended', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await buildEverything(deps);

  const before = (await deps.store.readEvents()).length;
  await repro.check(deps);
  assert.equal((await deps.store.readEvents()).length, before);
});

test('status counts the analysis objects and what is stale among them', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await buildEverything(deps);
  const { status } = await import('../../src/application/status.js');

  const fresh = await status(deps);
  assert.deepEqual(fresh.analysis, {
    datasets: 1,
    analyses: 1,
    results: 1,
    tables: 1,
    figures: 1,
    reproducible: 3,
    stale: 0,
  });

  await writeFile(join(root, 'data', 'survey.csv'), EDITED);
  assert.equal(
    (await status(deps)).analysis.stale,
    3,
    'the analysis, and the table and figure drawn from its result',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { localRunner } from '../../src/adapters/execution/local.js';
import { parseTable } from '../../src/adapters/documents/index.js';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { read, realpath } from '../../src/adapters/store/fs-walk.js';
import * as analyze from '../../src/application/analyze.js';
import * as data from '../../src/application/data.js';
import { PhdudeError } from '../../src/domain/errors.js';
import { sha256 } from '../../src/domain/hash.js';
import { CURRENT_WORKSPACE_VERSION } from '../../src/domain/versioning.js';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'scripts',
  'analysis-echo.mjs',
);

const actor = { researcher: 'test', agent: 'node' };
const RESULTS = 'analysis/out/describe-survey/results.json';

const SURVEY = ['id,age,group', '1,31,a', '2,44,b', '3,,a'].join('\n') + '\n';
const EDITED = ['id,age,group', '1,31,a', '2,44,b', '3,50,a'].join('\n') + '\n';

function makeDeps(root, startTick = 0) {
  let tick = startTick;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 8, 7, 10, 0, tick++)).toISOString(),
    actor,
    runner: localRunner,
    readBytes: (rel) => read(join(root, rel)),
    realpath,
    parseTable,
  };
}

async function newRoot({
  execution = true,
  workspaceVersion = CURRENT_WORKSPACE_VERSION,
  timeoutSeconds = 30,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-analyze-'));
  await mkdir(join(root, 'data'), { recursive: true });
  await mkdir(join(root, 'analysis'), { recursive: true });
  await mkdir(join(root, '.phdude'), { recursive: true });
  await writeFile(
    join(root, 'phdude.yaml'),
    [
      'schema: phdude.project',
      'version: 1',
      `workspace_version: ${workspaceVersion}`,
      'title: Analyze test',
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
    [
      'execution:',
      `  enabled: ${execution}`,
      '  runtimes:',
      `    node: ${JSON.stringify(process.execPath)}`,
      `  timeout_seconds: ${timeoutSeconds}`,
      '',
    ].join('\n'),
  );
  await copyFile(FIXTURE, join(root, 'analysis', 'echo.mjs'));
  await writeFile(join(root, 'data', 'survey.csv'), SURVEY);
  return root;
}

async function declare(deps, { args, inputs, outputs } = {}) {
  const dataset = inputs === undefined ? (await data.add(deps, 'data/survey.csv')).dataset : null;
  const { analysis } = await analyze.add(deps, {
    name: 'describe survey',
    runtime: 'node',
    script: 'analysis/echo.mjs',
    args: args ?? ['--input', 'data/survey.csv', '--out', RESULTS],
    inputs: inputs ?? [dataset.id],
    outputs,
  });
  return { analysis, dataset };
}

async function events(store, op) {
  const all = await store.readEvents();
  return op === undefined ? all : all.filter((e) => e.op === op);
}

async function readRecord(root, dir, id) {
  return parse(await readFile(join(root, dir, `${id}.yaml`), 'utf8'));
}

test('add records the declaration on disk and defaults the results path from the name', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { dataset } = await data.add(deps, 'data/survey.csv');

  const { analysis, created } = await analyze.add(deps, {
    name: 'Describe Survey',
    runtime: 'node',
    script: 'analysis/echo.mjs',
    inputs: [dataset.id],
    params: { alpha: 0.05 },
  });

  assert.equal(created, true);
  assert.match(analysis.id, /^ANALYSIS-[0-9a-f]{10}$/);
  assert.equal(analysis.outputs.results, RESULTS);
  assert.deepEqual(analysis.outputs.files, []);
  assert.deepEqual(analysis.runs, []);
  assert.equal(analysis.state, 'candidate');

  assert.deepEqual(await readRecord(root, 'analysis', analysis.id), analysis);
  const [event] = await events(deps.store, 'analyze');
  assert.deepEqual(event.ids, [analysis.id]);
  assert.match(event.summary, /declared/);
});

test('add refuses a script outside analysis/, an unknown input and an unknown field', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { dataset } = await data.add(deps, 'data/survey.csv');
  const base = {
    name: 'describe survey',
    runtime: 'node',
    script: 'analysis/echo.mjs',
    inputs: [dataset.id],
  };

  await assert.rejects(
    analyze.add(deps, { ...base, script: '../outside.mjs' }),
    (err) => err.code === 'VALIDATION' && /outside analysis\//.test(err.message),
  );
  await assert.rejects(
    analyze.add(deps, { ...base, inputs: ['DATASET-9999999999'] }),
    (err) => err.code === 'VALIDATION' && /DATASET-9999999999/.test(err.message),
  );
  await assert.rejects(
    analyze.add(deps, { ...base, inputs: ['CLAIM-0123456789'] }),
    (err) => err.code === 'VALIDATION' && /not a dataset id/.test(err.message),
  );
  await assert.rejects(
    analyze.add(deps, { ...base, runtime: 'bash' }),
    (err) => err.code === 'VALIDATION' && /runtime/.test(err.message),
  );
  await assert.rejects(
    analyze.add(deps, { ...base, method: 'regression' }),
    (err) => err.code === 'VALIDATION' && /method/.test(err.message),
  );
  await assert.rejects(
    analyze.add(deps, { ...base, outputs: { results: 'out/results.json', files: [] } }),
    (err) => err.code === 'VALIDATION' && /results output/.test(err.message),
  );
  await assert.rejects(
    analyze.add(deps, { ...base, outputs: { results: RESULTS, files: ['../escape.svg'] } }),
    (err) => err.code === 'VALIDATION' && /outside the workspace/.test(err.message),
  );

  assert.deepEqual(await deps.store.listEntities('analysis'), []);
  assert.equal((await events(deps.store, 'analyze')).length, 0);
});

test('re-declaring the same analysis unchanged writes nothing and records no event', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { analysis, dataset } = await declare(deps);

  const again = await analyze.add(deps, {
    name: 'describe survey',
    runtime: 'node',
    script: 'analysis/echo.mjs',
    args: ['--input', 'data/survey.csv', '--out', RESULTS],
    inputs: [dataset.id],
  });

  assert.equal(again.created, false);
  assert.equal(again.changed, false);
  assert.deepEqual(again.analysis, analysis);
  assert.equal((await events(deps.store, 'analyze')).length, 1);
});

test('re-declaring with a changed script corrects the record and keeps its runs', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { analysis, dataset } = await declare(deps);
  await analyze.run(deps, { id: analysis.id });

  const before = await deps.store.readEntity(analysis.id);
  assert.equal(before.runs.length, 1);

  const again = await analyze.add(deps, {
    name: 'describe survey',
    runtime: 'node',
    script: 'analysis/echo.mjs',
    args: ['--input', 'data/survey.csv', '--out', RESULTS, '--extra-file'],
    inputs: [dataset.id],
  });

  assert.equal(again.created, false);
  assert.equal(again.changed, true);
  assert.deepEqual(again.analysis.args.slice(-1), ['--extra-file']);
  assert.equal(again.analysis.id, analysis.id);
  assert.equal(again.analysis.created, analysis.created, 'the record keeps its own creation time');
  assert.equal(again.analysis.runs.length, 1, 'the run history survives a corrected declaration');
  assert.deepEqual(await readRecord(root, 'analysis', analysis.id), again.analysis);

  const declarations = (await events(deps.store, 'analyze')).filter((e) =>
    /declar/.test(e.summary),
  );
  assert.equal(declarations.length, 2);
  assert.match(declarations[1].summary, /redeclared/);
});

test('run refuses when the execution policy is closed, and writes nothing', async (t) => {
  const root = await newRoot({ execution: false });
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { analysis } = await declare(deps);
  const before = (await events(deps.store)).length;

  await assert.rejects(analyze.run(deps, { id: analysis.id }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'POLICY');
    assert.match(err.message, /script execution is disabled/);
    assert.match(err.hint, /--allow-exec/);
    return true;
  });

  assert.equal((await deps.store.readEntity(analysis.id)).runs.length, 0);
  assert.deepEqual(await deps.store.listEntities('result'), []);
  assert.equal((await events(deps.store)).length, before);
  assert.equal(await deps.store.readText(RESULTS), null);
});

test('run with --allow-exec opens a closed policy for one run', async (t) => {
  const root = await newRoot({ execution: false });
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { analysis } = await declare(deps);

  const outcome = await analyze.run(deps, { id: analysis.id, allowExec: true });
  assert.equal(outcome.ran, true);
  assert.equal(outcome.created.length, 2);
});

test('a successful run records the run, the hashes and one event, and writes the results', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { analysis, dataset } = await declare(deps, {
    args: ['--input', 'data/survey.csv', '--out', RESULTS, '--extra-file'],
    outputs: { results: RESULTS, files: ['analysis/out/describe-survey/summary.csv'] },
  });

  const outcome = await analyze.run(deps, { id: analysis.id });

  assert.equal(outcome.ran, true);
  assert.equal(outcome.created.length, 2);
  assert.equal(outcome.kept.length, 0);
  assert.equal(outcome.rejected.length, 0);

  const recorded = await readRecord(root, 'analysis', analysis.id);
  assert.equal(recorded.runs.length, 1);
  const [run] = recorded.runs;
  assert.equal(run.exit, 0);
  assert.ok(Number.isInteger(run.duration_ms) && run.duration_ms >= 0);
  assert.deepEqual(run.input_hashes, { [dataset.id]: dataset.hash });
  assert.deepEqual(Object.keys(run.output_hashes).sort(), [
    RESULTS,
    'analysis/out/describe-survey/summary.csv',
  ]);
  assert.equal(
    run.output_hashes[RESULTS],
    sha256(await readFile(join(root, RESULTS))),
    'the recorded output hash is the hash of the file on disk',
  );
  assert.deepEqual(run.results.sort(), outcome.created.map((r) => r.id).sort());
  assert.equal(run.stderr_tail, undefined);
  assert.equal(run.timed_out, undefined);

  const byKey = new Map(outcome.created.map((r) => [r.ext.analysis.key, r]));
  const mean = byKey.get('mean_age');
  assert.equal(mean.from, analysis.id);
  assert.equal(mean.state, 'candidate');
  assert.deepEqual(mean.values, { mean: 37.5, n: 2 });
  assert.equal(mean.ext.analysis.unit, 'years');
  assert.equal(mean.ext.analysis.run_at, run.at);
  assert.match(mean.summary, /37\.5 years/);
  assert.deepEqual(await readRecord(root, join('knowledge', 'results'), mean.id), mean);

  const runEvents = (await events(deps.store, 'analyze')).filter((e) => /run/.test(e.summary));
  assert.equal(runEvents.length, 1, 'one event per run, however many results it wrote');
  assert.deepEqual(
    runEvents[0].ids.sort(),
    [analysis.id, ...outcome.created.map((r) => r.id)].sort(),
  );

  const written = JSON.parse(await readFile(join(root, RESULTS), 'utf8'));
  assert.deepEqual(written.notes, [`ran as ${analysis.id}`], 'the script saw PHDUDE_ANALYSIS');
});

test('re-running with unchanged inputs is refused as up to date, with no event and no run', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { analysis } = await declare(deps);
  await analyze.run(deps, { id: analysis.id });
  const before = (await events(deps.store)).length;

  const outcome = await analyze.run(deps, { id: analysis.id });

  assert.equal(outcome.ran, false);
  assert.equal(outcome.reason, 'up to date');
  assert.equal((await deps.store.readEntity(analysis.id)).runs.length, 1);
  assert.equal((await events(deps.store)).length, before);
});

test('--force re-runs; identical findings are kept rather than rewritten', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { analysis } = await declare(deps);
  const first = await analyze.run(deps, { id: analysis.id });

  const outcome = await analyze.run(deps, { id: analysis.id, force: true });

  assert.equal(outcome.ran, true);
  assert.deepEqual(outcome.created, []);
  assert.deepEqual(outcome.rejected, []);
  assert.equal(outcome.kept.length, 2);
  assert.equal((await deps.store.listEntities('result')).length, 2, 'no second copy was written');

  const recorded = await deps.store.readEntity(analysis.id);
  assert.equal(recorded.runs.length, 2);
  assert.deepEqual(recorded.runs[1].results.sort(), recorded.runs[0].results.sort());

  const kept = await deps.store.readEntity(first.created[0].id);
  assert.equal(
    kept.ext.analysis.run_at,
    recorded.runs[0].at,
    'an unchanged finding keeps the run that first reported it',
  );
});

test('a changed dataset makes a new result and marks the old one superseded', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { analysis, dataset } = await declare(deps);
  const first = await analyze.run(deps, { id: analysis.id });

  await writeFile(join(root, 'data', 'survey.csv'), EDITED);
  const { dataset: second } = await data.add(deps, 'data/survey.csv');
  assert.notEqual(second.id, dataset.id);

  await analyze.add(deps, {
    name: 'describe survey',
    runtime: 'node',
    script: 'analysis/echo.mjs',
    args: ['--input', 'data/survey.csv', '--out', RESULTS],
    inputs: [second.id],
  });

  const outcome = await analyze.run(deps, { id: analysis.id });

  assert.equal(outcome.ran, true);
  assert.equal(outcome.created.length, 2);
  assert.equal(outcome.rejected.length, 2);
  assert.equal(outcome.kept.length, 0);

  for (const old of first.created) {
    const record = await deps.store.readEntity(old.id);
    assert.equal(record.state, 'rejected');
    const replacement = outcome.created.find((r) => r.ext.analysis.key === record.ext.analysis.key);
    assert.equal(record.superseded_by, replacement.id);
  }
  assert.equal((await deps.store.listEntities('result')).length, 4, 'the old findings are kept');

  const recorded = await deps.store.readEntity(analysis.id);
  assert.deepEqual(recorded.runs[1].input_hashes, { [second.id]: second.hash });

  const runEvents = (await events(deps.store, 'analyze')).filter((e) => /run/.test(e.summary));
  assert.equal(runEvents.length, 2);
  assert.equal(runEvents[1].ids.length, 5, 'the analysis, two new results and two superseded');
});

test('a finding whose summary never changes is corrected in place, not superseded', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const args = ['--input', 'data/survey.csv', '--out', RESULTS, '--stable-summary'];
  const { analysis } = await declare(deps, { args });
  const first = await analyze.run(deps, { id: analysis.id });
  const stable = first.created.find((r) => r.ext.analysis.key === 'mean_age');

  await writeFile(join(root, 'data', 'survey.csv'), EDITED);
  const { dataset: second } = await data.add(deps, 'data/survey.csv');
  await analyze.add(deps, {
    name: 'describe survey',
    runtime: 'node',
    script: 'analysis/echo.mjs',
    args,
    inputs: [second.id],
  });

  const outcome = await analyze.run(deps, { id: analysis.id });
  const rewritten = outcome.created.find((r) => r.ext.analysis.key === 'mean_age');

  assert.equal(rewritten.id, stable.id, 'the summary is the identity, so the id did not change');
  assert.ok(!outcome.rejected.some((r) => r.id === stable.id), 'a record cannot supersede itself');
  const onDisk = await deps.store.readEntity(stable.id);
  assert.deepEqual(onDisk.values, { mean: 41.7, n: 3 });
  assert.equal(onDisk.state, 'candidate');
});

test('a script that exits non-zero records the run and the stderr, and writes no result', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { analysis, dataset } = await declare(deps, {
    args: ['--input', 'data/survey.csv', '--out', RESULTS, '--fail', '3'],
  });

  await assert.rejects(analyze.run(deps, { id: analysis.id }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'EXECUTION');
    assert.match(err.message, /exited 3/);
    assert.ok(err.details.some((line) => /no such column/.test(line)));
    return true;
  });

  const recorded = await deps.store.readEntity(analysis.id);
  assert.equal(recorded.runs.length, 1);
  assert.equal(recorded.runs[0].exit, 3);
  assert.match(recorded.runs[0].stderr_tail, /no such column: age/);
  assert.deepEqual(recorded.runs[0].results, []);
  assert.deepEqual(recorded.runs[0].output_hashes, {});
  assert.deepEqual(recorded.runs[0].input_hashes, { [dataset.id]: dataset.hash });

  assert.deepEqual(await deps.store.listEntities('result'), []);
  const runEvents = (await events(deps.store, 'analyze')).filter((e) => /failed/.test(e.summary));
  assert.equal(runEvents.length, 1);
  assert.deepEqual(runEvents[0].ids, [analysis.id]);
});

test('a failed run leaves the analysis stale, so the next run is not refused', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { analysis } = await declare(deps, {
    args: ['--input', 'data/survey.csv', '--out', RESULTS, '--fail', '3'],
  });
  await assert.rejects(analyze.run(deps, { id: analysis.id }));

  await analyze.add(deps, {
    name: 'describe survey',
    runtime: 'node',
    script: 'analysis/echo.mjs',
    args: ['--input', 'data/survey.csv', '--out', RESULTS],
    inputs: analysis.inputs,
  });

  const outcome = await analyze.run(deps, { id: analysis.id });
  assert.equal(outcome.ran, true);
});

test('a script that outruns the timeout is recorded as timed out and reported as TOOL_MISSING', async (t) => {
  const root = await newRoot({ timeoutSeconds: 1 });
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { analysis } = await declare(deps, {
    args: ['--input', 'data/survey.csv', '--out', RESULTS, '--hang'],
  });

  await assert.rejects(analyze.run(deps, { id: analysis.id }), (err) => {
    assert.equal(err.code, 'TOOL_MISSING');
    assert.match(err.message, /timed out after 1s/);
    assert.match(err.hint, /execution\.timeout_seconds/);
    return true;
  });

  const recorded = await deps.store.readEntity(analysis.id);
  assert.equal(recorded.runs.length, 1);
  assert.equal(recorded.runs[0].exit, null);
  assert.equal(recorded.runs[0].timed_out, true);
  assert.deepEqual(await deps.store.listEntities('result'), []);
  assert.equal(
    (await events(deps.store, 'analyze')).filter((e) => /timed out/.test(e.summary)).length,
    1,
  );
});

test('a results.json that never arrived, or does not parse, is a validation error that records nothing', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);

  for (const [flag, pattern] of [
    ['--no-output', /wrote no results file/],
    ['--malformed', /malformed results\.json/],
    ['--bad-shape', /does not match the results contract/],
    ['--blank-summary', /unusable result/],
  ]) {
    const { analysis } = await declare(deps, {
      args: ['--input', 'data/survey.csv', '--out', RESULTS, flag],
    });
    const before = (await events(deps.store)).length;

    await assert.rejects(analyze.run(deps, { id: analysis.id, force: true }), (err) => {
      assert.equal(err.code, 'VALIDATION', flag);
      assert.match(err.message, pattern);
      return true;
    });

    assert.deepEqual(await deps.store.listEntities('result'), [], flag);
    assert.equal(
      (await deps.store.readEntity(analysis.id)).runs.length,
      0,
      `${flag}: a run PhDude cannot read the results of is not recorded as a run`,
    );
    assert.equal((await events(deps.store)).length, before, flag);
    await rm(join(root, RESULTS), { force: true });
  }
});

test('run refuses an id that is not an analysis, and one that does not exist', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);

  await assert.rejects(
    analyze.run(deps, { id: 'CLAIM-0123456789' }),
    (err) => err.code === 'USAGE',
  );
  await assert.rejects(
    analyze.run(deps, { id: 'ANALYSIS-0123456789' }),
    (err) => err.code === 'USAGE' && /not found/.test(err.message),
  );
});

test('run refuses a runtime the workspace policy does not name', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { dataset } = await data.add(deps, 'data/survey.csv');
  const { analysis } = await analyze.add(deps, {
    name: 'julia bits',
    runtime: 'other',
    script: 'analysis/echo.mjs',
    inputs: [dataset.id],
  });

  await assert.rejects(
    analyze.run(deps, { id: analysis.id }),
    (err) => err.code === 'VALIDATION' && /unknown runtime: other/.test(err.message),
  );
  assert.equal((await deps.store.readEntity(analysis.id)).runs.length, 0);
});

test('run refuses when an input dataset has gone missing', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { analysis, dataset } = await declare(deps);
  await rm(join(root, 'knowledge', 'datasets', `${dataset.id}.yaml`));

  await assert.rejects(
    analyze.run(deps, { id: analysis.id }),
    (err) => err.code === 'VALIDATION' && new RegExp(dataset.id).test(err.message),
  );
});

test('list, show and runs read what add and run recorded', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const { analysis } = await declare(deps);
  await analyze.run(deps, { id: analysis.id });

  const listed = await analyze.list(deps);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, analysis.id);

  const shown = await analyze.show(deps, analysis.id);
  assert.equal(shown.runs.length, 1);

  const history = await analyze.runs(deps, analysis.id);
  assert.equal(history.id, analysis.id);
  assert.equal(history.name, 'describe survey');
  assert.equal(history.runs.length, 1);

  await assert.rejects(analyze.show(deps, 'CLAIM-0123456789'), (err) => err.code === 'USAGE');
});

test('add and run refuse a workspace that has not been migrated', async (t) => {
  const root = await newRoot({ workspaceVersion: CURRENT_WORKSPACE_VERSION - 1 });
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);

  await assert.rejects(
    analyze.add(deps, { name: 'x', runtime: 'node', script: 'analysis/echo.mjs' }),
    (err) => err.code === 'USAGE' && /needs migration/.test(err.message),
  );
  await assert.rejects(
    analyze.run(deps, { id: 'ANALYSIS-0123456789' }),
    (err) => err.code === 'USAGE' && /needs migration/.test(err.message),
  );
});

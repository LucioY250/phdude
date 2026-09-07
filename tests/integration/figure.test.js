import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { localRunner } from '../../src/adapters/execution/local.js';
import { DEFAULT_GENERATORS_DIR } from '../../src/adapters/execution/generators.js';
import { parseTable } from '../../src/adapters/documents/index.js';
import { read, realpath } from '../../src/adapters/store/fs-walk.js';
import { CURRENT_WORKSPACE_VERSION } from '../../src/domain/versioning.js';
import { newDataset, newResult } from '../../src/domain/entities.js';
import { profileTable } from '../../src/domain/datasets.js';
import { sha256 } from '../../src/domain/hash.js';
import * as figure from '../../src/application/figure.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const actor = { researcher: 'test', agent: 'node' };
const created = '2026-09-07T09:00:00Z';

const SURVEY = ['id,age,group', '1,31,a', '2,44,b', '3,52,a'].join('\n') + '\n';

const RESULTS_JSON = JSON.stringify({
  results: [
    {
      key: 'mean_weight_by_group',
      summary: 'Group b averages more than group a.',
      values: { a: 71.4, b: 75.5 },
      unit: 'kg',
    },
  ],
});

const FIELDS = {
  name: 'mean-weight',
  caption: 'Mean weight by group.',
  alt: 'Bar chart: group b averages 75.5 kg against group a at 71.4 kg.',
  generator: {
    runtime: 'node',
    script: 'phdude:bar-chart',
    args: [
      '--input',
      'analysis/out/results.json',
      '--key',
      'mean_weight_by_group',
      '--out',
      'figures/out/mean-weight.svg',
      '--title',
      'Mean weight by group',
      '--alt',
      'Bar chart: group b averages 75.5 kg against group a at 71.4 kg.',
    ],
  },
  outputs: [{ path: 'figures/out/mean-weight.svg', format: 'svg' }],
};

function makeDeps(root, { runner = localRunner } = {}) {
  let tick = 0;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 8, 7, 10, 0, tick++)).toISOString(),
    actor,
    runner,
    readBytes: (rel) => read(join(root, rel)),
    realpath,
    parseTable,
    generatorsDir: DEFAULT_GENERATORS_DIR,
  };
}

async function newRoot({ execution = true, workspaceVersion = CURRENT_WORKSPACE_VERSION } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-figure-'));
  await mkdir(join(root, '.phdude'), { recursive: true });
  await mkdir(join(root, 'analysis', 'out'), { recursive: true });
  await mkdir(join(root, 'data'), { recursive: true });
  await mkdir(join(root, 'figures'), { recursive: true });
  await writeFile(
    join(root, 'phdude.yaml'),
    [
      'schema: phdude.project',
      'version: 1',
      `workspace_version: ${workspaceVersion}`,
      'title: Figure test',
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
    ['execution:', `  enabled: ${execution}`, '  timeout_seconds: 60', ''].join('\n'),
  );
  await writeFile(join(root, 'analysis', 'out', 'results.json'), RESULTS_JSON);
  await writeFile(join(root, 'data', 'survey.csv'), SURVEY);
  return root;
}

async function withResult(deps) {
  const result = newResult({
    summary: 'Group b averages more than group a.',
    from: 'ART-0123456789',
    values: { a: 71.4, b: 75.5 },
    actor,
    created,
  });
  await deps.store.writeEntity(result);
  return result;
}

async function withDataset(deps) {
  const bytes = Buffer.from(SURVEY);
  const dataset = newDataset({
    path: 'data/survey.csv',
    hash: sha256(bytes),
    bytes: bytes.length,
    format: 'csv',
    profile: profileTable(await parseTable(bytes, 'csv')),
    actor,
    created,
  });
  await deps.store.writeEntity(dataset);
  return dataset;
}

async function events(store, op) {
  return (await store.readEvents()).filter((e) => e.op === op);
}

async function writeScript(root, rel, body) {
  const path = join(root, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  await chmod(path, 0o755);
  return rel;
}

test('add records a figure with its alt text and appends one event', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const result = await withResult(deps);

  const added = await figure.add(deps, { ...FIELDS, inputs: [result.id] });

  assert.equal(added.created, true);
  assert.match(added.figure.id, /^FIG-[0-9a-f]{10}$/);
  assert.equal(added.figure.alt, FIELDS.alt);
  assert.deepEqual(added.figure.runs, []);

  const onDisk = parse(await readFile(join(root, 'figures', `${added.figure.id}.yaml`), 'utf8'));
  assert.deepEqual(onDisk, added.figure, 'the record on disk is the record returned');

  const [event] = await events(deps.store, 'figure');
  assert.deepEqual(event.ids, [added.figure.id]);
  assert.equal((await events(deps.store, 'figure')).length, 1);
});

test('add refuses a figure with no alt text, and writes nothing', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);

  await assert.rejects(figure.add(deps, { ...FIELDS, alt: '   ', inputs: [] }), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /alt text/);
    return true;
  });
  assert.deepEqual(await figure.list(deps), []);
  assert.deepEqual(await events(deps.store, 'figure'), []);
});

test('add refuses an unknown field, an unresolvable input and a generator outside figures/', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);

  await assert.rejects(figure.add(deps, { ...FIELDS, inputs: [], palette: 'viridis' }), {
    code: 'VALIDATION',
  });
  await assert.rejects(figure.add(deps, { ...FIELDS, inputs: ['RESULT-9999999999'] }), {
    code: 'VALIDATION',
  });
  await assert.rejects(
    figure.add(deps, {
      ...FIELDS,
      inputs: [],
      generator: { ...FIELDS.generator, script: 'analysis/plot.mjs' },
    }),
    { code: 'VALIDATION' },
  );
});

test('add is declarative: the same declaration twice writes nothing the second time', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const result = await withResult(deps);

  const first = await figure.add(deps, { ...FIELDS, inputs: [result.id] });
  const again = await figure.add(deps, { ...FIELDS, inputs: [result.id] });

  assert.equal(again.created, false);
  assert.equal(again.changed, false);
  assert.deepEqual(again.figure, first.figure);
  assert.equal((await events(deps.store, 'figure')).length, 1);
});

test('build runs the shipped generator, verifies the output, hashes it and records one run', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const result = await withResult(deps);
  const { figure: declared } = await figure.add(deps, { ...FIELDS, inputs: [result.id] });

  const built = await figure.build(deps, declared.id, {});

  assert.equal(built.run.exit, 0);
  assert.deepEqual(
    built.outputs.map((o) => o.path),
    ['figures/out/mean-weight.svg'],
  );

  const svg = await readFile(join(root, 'figures', 'out', 'mean-weight.svg'), 'utf8');
  assert.match(svg, /<desc id="figure-desc">Bar chart: group b averages 75\.5 kg/);
  assert.match(svg, /<svg xmlns=/);

  const stored = await figure.show(deps, declared.id);
  assert.equal(stored.runs.length, 1);
  assert.equal(stored.runs[0].exit, 0);
  assert.ok(Number.isInteger(stored.runs[0].duration_ms));
  assert.equal(stored.runs[0].output_hashes['figures/out/mean-weight.svg'], sha256(svg));
  assert.equal(
    stored.runs[0].input_hashes[result.id],
    built.run.input_hashes[result.id],
    'the run records the hash of every input it declared',
  );

  assert.equal((await events(deps.store, 'figure')).length, 2, 'one for the add, one for the run');
  assert.equal((await events(deps.store, 'figure')).at(-1).ids[0], declared.id);
});

test('build refuses when the policy has execution closed, and runs with --allow-exec', async (t) => {
  const root = await newRoot({ execution: false });
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const result = await withResult(deps);
  const { figure: declared } = await figure.add(deps, { ...FIELDS, inputs: [result.id] });

  await assert.rejects(figure.build(deps, declared.id, {}), (err) => {
    assert.equal(err.code, 'POLICY');
    assert.match(err.message, /script execution is disabled/);
    assert.match(err.hint, /--allow-exec/);
    return true;
  });
  assert.equal(await deps.store.exists('figures/out/mean-weight.svg'), false);
  assert.equal((await figure.show(deps, declared.id)).runs.length, 0);

  const built = await figure.build(deps, declared.id, { allowExec: true });
  assert.equal(built.run.exit, 0);
});

test('build runs a workspace generator under figures/', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeScript(
    root,
    join('figures', 'plot.mjs'),
    [
      "import { mkdir, writeFile } from 'node:fs/promises';",
      "await mkdir('figures/out', { recursive: true });",
      'await writeFile(\'figures/out/plain.svg\', `<svg xmlns="http://www.w3.org/2000/svg"><title>${process.env.PHDUDE_FIGURE}</title></svg>`);',
      '',
    ].join('\n'),
  );

  const { figure: declared } = await figure.add(deps, {
    name: 'plain',
    caption: 'A plain figure.',
    alt: 'A square.',
    generator: { runtime: 'node', script: 'figures/plot.mjs', args: [] },
    inputs: [],
    outputs: [{ path: 'figures/out/plain.svg', format: 'svg' }],
  });

  const built = await figure.build(deps, declared.id, {});
  assert.equal(built.run.exit, 0);
  const svg = await readFile(join(root, 'figures', 'out', 'plain.svg'), 'utf8');
  assert.match(
    svg,
    new RegExp(`<title>${declared.id}</title>`),
    'PHDUDE_FIGURE reaches the script',
  );
});

test('the generator sees the workspace, its figure id, and nothing else of the parent environment', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeScript(
    root,
    join('figures', 'env.mjs'),
    [
      "import { mkdir, writeFile } from 'node:fs/promises';",
      "await mkdir('figures/out', { recursive: true });",
      "await writeFile('figures/out/env.svg', JSON.stringify({ cwd: process.cwd(), env: process.env }));",
      '',
    ].join('\n'),
  );
  const { figure: declared } = await figure.add(deps, {
    name: 'env',
    caption: 'The environment.',
    alt: 'Not really a figure.',
    generator: { runtime: 'node', script: 'figures/env.mjs', args: [] },
    inputs: [],
    outputs: [{ path: 'figures/out/env.svg', format: 'svg' }],
  });

  process.env.PHDUDE_FIGURE_LEAK = 'the parent environment stays in the parent';
  try {
    await figure.build(deps, declared.id, {});
  } finally {
    delete process.env.PHDUDE_FIGURE_LEAK;
  }

  const reported = JSON.parse(await readFile(join(root, 'figures', 'out', 'env.svg'), 'utf8'));
  assert.equal(reported.cwd, root);
  assert.equal(reported.env.PHDUDE_WORKSPACE, root);
  assert.equal(reported.env.PHDUDE_FIGURE, declared.id);
  assert.equal(reported.env.PHDUDE_FIGURE_LEAK, undefined);
});

test('a generator that exits non-zero records the run, hashes nothing, and reports EXECUTION', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeScript(
    root,
    join('figures', 'fail.mjs'),
    ["process.stderr.write('no such column: weight\\n');", 'process.exit(3);', ''].join('\n'),
  );
  const { figure: declared } = await figure.add(deps, {
    name: 'broken',
    caption: 'A figure that never rendered.',
    alt: 'Nothing yet.',
    generator: { runtime: 'node', script: 'figures/fail.mjs', args: [] },
    inputs: [],
    outputs: [{ path: 'figures/out/broken.svg', format: 'svg' }],
  });

  await assert.rejects(figure.build(deps, declared.id, {}), (err) => {
    assert.equal(err.code, 'EXECUTION');
    assert.match(err.message, /exited 3/);
    assert.ok(err.details.some((line) => line.includes('no such column')));
    return true;
  });

  const stored = await figure.show(deps, declared.id);
  assert.equal(stored.runs.length, 1, 'a failed run is still a run');
  assert.equal(stored.runs[0].exit, 3);
  assert.deepEqual(stored.runs[0].output_hashes, {});
  assert.equal((await events(deps.store, 'figure')).length, 2, 'a failed run is still an event');
});

test('a generator that exits 0 without writing its outputs is reported, not believed', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeScript(root, join('figures', 'quiet.mjs'), ['process.exit(0);', ''].join('\n'));
  const { figure: declared } = await figure.add(deps, {
    name: 'quiet',
    caption: 'A figure the generator never wrote.',
    alt: 'Nothing yet.',
    generator: { runtime: 'node', script: 'figures/quiet.mjs', args: [] },
    inputs: [],
    outputs: [{ path: 'figures/out/quiet.svg', format: 'svg' }],
  });

  await assert.rejects(figure.build(deps, declared.id, {}), (err) => {
    assert.equal(err.code, 'EXECUTION');
    assert.match(err.message, /figures\/out\/quiet\.svg/);
    return true;
  });

  const stored = await figure.show(deps, declared.id);
  assert.equal(stored.runs.length, 1);
  assert.equal(stored.runs[0].exit, 0);
  assert.deepEqual(stored.runs[0].output_hashes, {});
});

test('a generator that outruns the timeout is a TOOL_MISSING error naming the policy key', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const timedOutRunner = {
    name: 'stub',
    available: async () => true,
    run: async () => ({
      exitCode: null,
      timedOut: true,
      stdout: '',
      stderr: '',
      durationMs: 60_000,
    }),
  };
  const deps = makeDeps(root, { runner: timedOutRunner });
  const { figure: declared } = await figure.add(deps, { ...FIELDS, inputs: [] });

  await assert.rejects(figure.build(deps, declared.id, {}), (err) => {
    assert.equal(err.code, 'TOOL_MISSING');
    assert.match(err.message, /timed out after 60s/);
    assert.match(err.hint, /execution\.timeout_seconds/);
    return true;
  });

  const stored = await figure.show(deps, declared.id);
  assert.equal(stored.runs.length, 1);
  assert.equal(stored.runs[0].exit, null);
});

test('build resolves the runtime through the policy and refuses one the workspace never named', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const seen = [];
  const spy = {
    name: 'spy',
    available: async () => true,
    run: async (opts) => {
      seen.push(opts);
      return { exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 1 };
    },
  };
  const deps = makeDeps(root, { runner: spy });
  await writeFile(
    join(root, '.phdude', 'research-policy.yaml'),
    ['execution:', '  enabled: true', '  runtimes:', '    node: /usr/local/bin/node20', ''].join(
      '\n',
    ),
  );
  const { figure: declared } = await figure.add(deps, { ...FIELDS, inputs: [] });

  await assert.rejects(figure.build(deps, declared.id, {}), { code: 'EXECUTION' });
  assert.equal(seen[0].runtime, '/usr/local/bin/node20');
  assert.equal(seen[0].cwd, root);
  assert.equal(seen[0].timeoutMs, 600_000, 'a policy without a timeout falls back to the default');
  assert.equal(seen[0].script, join(DEFAULT_GENERATORS_DIR, 'bar-chart.mjs'));

  const { figure: other } = await figure.add(deps, {
    ...FIELDS,
    name: 'julia',
    generator: { ...FIELDS.generator, runtime: 'julia' },
  });
  await assert.rejects(figure.build(deps, other.id, {}), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /unknown runtime: julia/);
    return true;
  });
});

test('build records the hash of a dataset input as the bytes on disk right now', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const dataset = await withDataset(deps);
  const { figure: declared } = await figure.add(deps, {
    name: 'groups',
    caption: 'Respondents per group.',
    alt: 'Group a holds two respondents, group b one.',
    generator: {
      runtime: 'node',
      script: 'phdude:bar-chart',
      args: [
        '--input',
        'data/survey.csv',
        '--key',
        'group',
        '--out',
        'figures/out/groups.svg',
        '--title',
        'Respondents per group',
        '--alt',
        'Group a holds two respondents, group b one.',
      ],
    },
    inputs: [dataset.id],
    outputs: [{ path: 'figures/out/groups.svg', format: 'svg' }],
  });

  const built = await figure.build(deps, declared.id, {});
  assert.equal(built.run.input_hashes[dataset.id], dataset.hash);

  await writeFile(join(root, 'data', 'survey.csv'), SURVEY + '4,29,c\n');
  const rebuilt = await figure.build(deps, declared.id, {});
  assert.notEqual(rebuilt.run.input_hashes[dataset.id], dataset.hash);
});

test('check reports never-run, then up-to-date, then stale once the input moves', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const dataset = await withDataset(deps);
  const { figure: declared } = await figure.add(deps, {
    name: 'groups',
    caption: 'Respondents per group.',
    alt: 'Group a holds two respondents, group b one.',
    generator: {
      runtime: 'node',
      script: 'phdude:bar-chart',
      args: [
        '--input',
        'data/survey.csv',
        '--key',
        'group',
        '--out',
        'figures/out/groups.svg',
        '--title',
        'Respondents per group',
        '--alt',
        'Group a holds two respondents, group b one.',
      ],
    },
    inputs: [dataset.id],
    outputs: [{ path: 'figures/out/groups.svg', format: 'svg' }],
  });

  const never = await figure.check(deps);
  assert.equal(never.figures[0].status, 'never-run');
  assert.equal(never.findings, 1);

  await figure.build(deps, declared.id, {});
  const fresh = await figure.check(deps);
  assert.equal(fresh.figures[0].status, 'up-to-date');
  assert.equal(fresh.findings, 0);

  await writeFile(join(root, 'data', 'survey.csv'), SURVEY + '4,29,c\n');
  const stale = await figure.check(deps);
  assert.equal(stale.figures[0].status, 'stale');
  assert.deepEqual(
    stale.figures[0].findings.map((f) => f.kind),
    ['stale-input'],
  );

  await rm(join(root, 'figures', 'out', 'groups.svg'));
  const gone = await figure.check(deps);
  assert.equal(gone.figures[0].status, 'missing-output');
});

test('check reports a figure whose alt text was edited away, without running anything', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const result = await withResult(deps);
  const { figure: declared } = await figure.add(deps, { ...FIELDS, inputs: [result.id] });
  await deps.store.writeYamlAtomic(join('figures', `${declared.id}.yaml`), {
    ...declared,
    alt: ' ',
  });

  const report = await figure.check(deps);
  assert.deepEqual(
    report.figures[0].findings.map((f) => f.kind),
    ['missing-alt', 'never-run'],
  );
  assert.equal(report.findings, 2);
});

test('every mutator stops on a workspace that needs migrating', async (t) => {
  const root = await newRoot({ workspaceVersion: 1 });
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);

  await assert.rejects(figure.add(deps, { ...FIELDS, inputs: [] }), {
    code: 'USAGE',
    hint: 'run phdude migrate',
  });
  await assert.rejects(figure.build(deps, 'FIG-0123456789', {}), {
    code: 'USAGE',
    hint: 'run phdude migrate',
  });
});

test('show and build refuse an id that is not a figure, and a figure that is not there', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);

  assert.deepEqual(await figure.list(deps), []);
  await assert.rejects(figure.show(deps, 'TABLE-0123456789'), { code: 'USAGE' });
  await assert.rejects(figure.show(deps, 'FIG-0123456789'), { code: 'USAGE' });
  await assert.rejects(figure.build(deps, 'FIG-0123456789', {}), { code: 'USAGE' });
});

test('the shipped generator is the one the package ships, resolved outside the workspace', async () => {
  assert.equal(DEFAULT_GENERATORS_DIR, join(REPO_ROOT, 'generators'));
  assert.ok(await read(join(DEFAULT_GENERATORS_DIR, 'bar-chart.mjs')));
});

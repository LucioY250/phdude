import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { parseTable } from '../../src/adapters/documents/index.js';
import { read } from '../../src/adapters/store/fs-walk.js';
import { CURRENT_WORKSPACE_VERSION } from '../../src/domain/versioning.js';
import { newDataset, newResult } from '../../src/domain/entities.js';
import { profileTable } from '../../src/domain/datasets.js';
import { sha256 } from '../../src/domain/hash.js';
import * as data from '../../src/application/data.js';
import * as table from '../../src/application/table.js';

const actor = { researcher: 'test', agent: 'node' };
const created = '2026-09-07T09:00:00Z';

const SURVEY = [
  'id,age,group,joined',
  '1,31,a,2026-01-02',
  '2,44,b,2026-02-03',
  '3,,a,',
  '4,52,b,2026-03-04',
].join('\n');

function makeDeps(root, startTick = 0) {
  let tick = startTick;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 8, 7, 10, 0, tick++)).toISOString(),
    actor,
    readBytes: (rel) => read(join(root, rel)),
    parseTable,
  };
}

async function newRoot({ workspaceVersion = CURRENT_WORKSPACE_VERSION } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-table-'));
  await mkdir(join(root, 'data'), { recursive: true });
  await writeFile(
    join(root, 'phdude.yaml'),
    [
      'schema: phdude.project',
      'version: 1',
      `workspace_version: ${workspaceVersion}`,
      'title: Table test',
      'language: en',
      'fields: []',
      'methods: []',
      'outputs: [thesis]',
      'mode: full',
      'agents: [claude-code]',
    ].join('\n') + '\n',
  );
  return root;
}

async function withResult(deps, values = { a: 71.4, b: 75.5 }) {
  const result = newResult({
    summary: 'Group b averages more than group a.',
    from: 'ART-0123456789',
    values,
    actor,
    created,
  });
  await deps.store.writeEntity(result);
  return result;
}

async function withDataset(deps, text = SURVEY + '\n') {
  await writeFile(join(deps.store.root, 'data', 'survey.csv'), text);
  const bytes = Buffer.from(text);
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

test('add writes a table declaration on disk, with one output per format and one event', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const result = await withResult(deps);

  const added = await table.add(deps, {
    name: 'mean-weight',
    caption: 'Mean weight by group.',
    source: { result: result.id },
    columns: [
      { key: 'key', label: 'Group' },
      { key: 'value', label: 'Mean', format: 'number:2' },
    ],
  });

  assert.equal(added.created, true);
  assert.match(added.table.id, /^TABLE-[0-9a-f]{10}$/);
  assert.deepEqual(added.table.runs, []);

  const onDisk = parse(await readFile(join(root, 'tables', `${added.table.id}.yaml`), 'utf8'));
  assert.deepEqual(onDisk, added.table, 'the record on disk is the record returned');
  assert.deepEqual(onDisk.outputs, {
    md: 'tables/out/mean-weight.md',
    latex: 'tables/out/mean-weight.tex',
    csv: 'tables/out/mean-weight.csv',
  });

  const [event] = await events(deps.store, 'table');
  assert.deepEqual(event.ids, [added.table.id]);
  assert.equal((await events(deps.store, 'table')).length, 1);
});

test('add is declarative: the same declaration twice writes nothing the second time', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const result = await withResult(deps);
  const fields = {
    name: 'mean-weight',
    caption: 'Mean weight by group.',
    source: { result: result.id },
  };

  const first = await table.add(deps, fields);
  const again = await table.add(deps, fields);

  assert.equal(again.created, false);
  assert.equal(again.changed, false);
  assert.deepEqual(again.table, first.table);
  assert.equal((await events(deps.store, 'table')).length, 1, 'a no-op records no event');
});

test('add re-declares a table under the same id, keeping its runs and its created date', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const result = await withResult(deps);
  const fields = {
    name: 'mean-weight',
    caption: 'Mean weight by group.',
    source: { result: result.id },
  };

  const first = await table.add(deps, fields);
  await table.build(deps, first.table.id, {});
  const rebuilt = await table.show(deps, first.table.id);
  assert.equal(rebuilt.runs.length, 1);

  const second = await table.add(deps, { ...fields, caption: 'Mean weight by group, in kg.' });
  assert.equal(second.created, false);
  assert.equal(second.changed, true);
  assert.equal(second.table.id, first.table.id);
  assert.equal(second.table.caption, 'Mean weight by group, in kg.');
  assert.equal(second.table.created, first.table.created);
  assert.equal(second.table.runs.length, 1, 'the run history survives a re-declaration');
});

test('add refuses a source that does not resolve, an unknown field and a bad name', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const result = await withResult(deps);

  await assert.rejects(
    table.add(deps, { name: 'x', caption: 'c', source: { result: 'RESULT-9999999999' } }),
    { code: 'VALIDATION' },
  );
  await assert.rejects(table.add(deps, { name: 'x', caption: 'c', source: {} }), {
    code: 'VALIDATION',
  });
  await assert.rejects(
    table.add(deps, { name: 'x', caption: 'c', source: { result: result.id }, colours: [] }),
    { code: 'VALIDATION' },
  );
  await assert.rejects(
    table.add(deps, { name: 'Not A Slug', caption: 'c', source: { result: result.id } }),
    { code: 'VALIDATION' },
  );
  // `columns` and `limit` narrow a dataset; on a result they would be silently ignored.
  await assert.rejects(
    table.add(deps, { name: 'x', caption: 'c', source: { result: result.id, limit: 2 } }),
    { code: 'VALIDATION' },
  );

  assert.deepEqual(await table.list(deps), []);
  assert.deepEqual(await events(deps.store, 'table'), []);
});

test('build renders every declared format, records the run, and appends one event', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const result = await withResult(deps);
  const { table: declared } = await table.add(deps, {
    name: 'mean-weight',
    caption: 'Mean weight by group.',
    source: { result: result.id },
    columns: [
      { key: 'key', label: 'Group' },
      { key: 'value', label: 'Mean', format: 'number:1' },
    ],
  });

  const built = await table.build(deps, declared.id, {});
  assert.equal(built.built, true);
  assert.deepEqual(
    built.outputs.map((o) => o.format),
    ['md', 'latex', 'csv'],
  );

  const md = await readFile(join(root, 'tables', 'out', 'mean-weight.md'), 'utf8');
  assert.equal(
    md,
    [
      '| Group | Mean |',
      '| --- | ---: |',
      '| a | 71.4 |',
      '| b | 75.5 |',
      '',
      'Table: Mean weight by group.',
      '',
    ].join('\n'),
  );
  const tex = await readFile(join(root, 'tables', 'out', 'mean-weight.tex'), 'utf8');
  assert.match(tex, /\\begin\{tabular\}\{lr\}/);
  const csv = await readFile(join(root, 'tables', 'out', 'mean-weight.csv'), 'utf8');
  assert.equal(csv, 'Group,Mean\na,71.4\nb,75.5\n');

  const stored = await table.show(deps, declared.id);
  assert.equal(stored.runs.length, 1);
  assert.equal(stored.runs[0].source_hash, built.sourceHash);
  assert.deepEqual(Object.keys(stored.runs[0].output_hashes), [
    'tables/out/mean-weight.md',
    'tables/out/mean-weight.tex',
    'tables/out/mean-weight.csv',
  ]);
  assert.equal(stored.runs[0].output_hashes['tables/out/mean-weight.md'], sha256(md));

  const built2 = (await events(deps.store, 'table')).at(-1);
  assert.deepEqual(built2.ids, [declared.id]);
  assert.equal((await events(deps.store, 'table')).length, 2, 'one for the add, one for the build');
});

test('build with an unchanged source is up to date: no write, no event, until --force', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const result = await withResult(deps);
  const { table: declared } = await table.add(deps, {
    name: 'mean-weight',
    caption: 'Mean weight by group.',
    source: { result: result.id },
  });

  await table.build(deps, declared.id, {});
  const again = await table.build(deps, declared.id, {});

  assert.equal(again.built, false);
  assert.equal(again.reason, 'up to date');
  assert.equal((await table.show(deps, declared.id)).runs.length, 1);
  assert.equal((await events(deps.store, 'table')).length, 2);

  const forced = await table.build(deps, declared.id, { force: true });
  assert.equal(forced.built, true);
  assert.equal((await table.show(deps, declared.id)).runs.length, 2);
  assert.equal((await events(deps.store, 'table')).length, 3);
});

test('build rewrites an output a researcher deleted, even when the source has not moved', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const result = await withResult(deps);
  const { table: declared } = await table.add(deps, {
    name: 'mean-weight',
    caption: 'Mean weight by group.',
    source: { result: result.id },
    formats: ['md'],
  });

  await table.build(deps, declared.id, {});
  await rm(join(root, 'tables', 'out', 'mean-weight.md'));

  const rebuilt = await table.build(deps, declared.id, {});
  assert.equal(rebuilt.built, true);
  assert.ok(await deps.store.exists('tables/out/mean-weight.md'));
});

test('build rebuilds when the result values change', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const result = await withResult(deps);
  const { table: declared } = await table.add(deps, {
    name: 'mean-weight',
    caption: 'Mean weight by group.',
    source: { result: result.id },
    formats: ['csv'],
  });
  const first = await table.build(deps, declared.id, {});

  await deps.store.writeEntity({ ...result, values: { a: 71.4, b: 80.1 } });
  const second = await table.build(deps, declared.id, {});

  assert.equal(second.built, true);
  assert.notEqual(second.sourceHash, first.sourceHash);
  assert.match(await readFile(join(root, 'tables', 'out', 'mean-weight.csv'), 'utf8'), /80\.1/);
});

test('build renders a dataset through the document parsers, narrowed by columns and limit', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const dataset = await withDataset(deps);
  const { table: declared } = await table.add(deps, {
    name: 'respondents',
    caption: 'The first two respondents.',
    source: { dataset: dataset.id, columns: ['group', 'age'], limit: 2 },
    formats: ['csv'],
  });

  const built = await table.build(deps, declared.id, {});
  assert.equal(built.built, true);
  assert.equal(
    await readFile(join(root, 'tables', 'out', 'respondents.csv'), 'utf8'),
    'group,age\na,31\nb,44\n',
  );
  assert.equal(built.sourceHash, dataset.hash, 'the run records the bytes it read');
});

test('build reports a dataset column the file has not got', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const dataset = await withDataset(deps);
  const { table: declared } = await table.add(deps, {
    name: 'respondents',
    caption: 'Respondents.',
    source: { dataset: dataset.id, columns: ['weight'] },
  });

  await assert.rejects(table.build(deps, declared.id, {}), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /no column\(s\): weight/);
    return true;
  });
  assert.equal((await table.show(deps, declared.id)).runs.length, 0, 'a refusal records no run');
});

test('build reports a dataset whose file is gone', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const dataset = await withDataset(deps);
  const { table: declared } = await table.add(deps, {
    name: 'respondents',
    caption: 'Respondents.',
    source: { dataset: dataset.id },
  });
  await rm(join(root, 'data', 'survey.csv'));

  await assert.rejects(table.build(deps, declared.id, {}), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /data\/survey\.csv/);
    return true;
  });
});

test('build renders after an edited dataset, and records the bytes it actually read', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const dataset = await withDataset(deps);
  const { table: declared } = await table.add(deps, {
    name: 'respondents',
    caption: 'Respondents.',
    source: { dataset: dataset.id, columns: ['group'] },
    formats: ['csv'],
  });
  const first = await table.build(deps, declared.id, {});

  const edited = SURVEY + '\n5,29,c,2026-03-05\n';
  await writeFile(join(root, 'data', 'survey.csv'), edited);
  const second = await table.build(deps, declared.id, {});

  assert.equal(second.built, true);
  assert.notEqual(second.sourceHash, first.sourceHash);
  assert.equal(second.sourceHash, sha256(Buffer.from(edited)));
  assert.match(await readFile(join(root, 'tables', 'out', 'respondents.csv'), 'utf8'), /\nc\n/);
});

test('build --format renders only the formats asked for, of the ones declared', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  const result = await withResult(deps);
  const { table: declared } = await table.add(deps, {
    name: 'mean-weight',
    caption: 'Mean weight by group.',
    source: { result: result.id },
    formats: ['md', 'csv'],
  });

  const built = await table.build(deps, declared.id, { formats: ['csv'] });
  assert.deepEqual(
    built.outputs.map((o) => o.path),
    ['tables/out/mean-weight.csv'],
  );
  assert.equal(await deps.store.exists('tables/out/mean-weight.md'), false);

  await assert.rejects(table.build(deps, declared.id, { formats: ['latex'] }), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /latex/);
    return true;
  });
});

test('show and list refuse an id that is not a table, and a table that is not there', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);

  assert.deepEqual(await table.list(deps), []);
  await assert.rejects(table.show(deps, 'DATASET-0123456789'), { code: 'USAGE' });
  await assert.rejects(table.show(deps, 'TABLE-0123456789'), { code: 'USAGE' });
  await assert.rejects(table.build(deps, 'TABLE-0123456789', {}), { code: 'USAGE' });
});

test('every mutator stops on a workspace that needs migrating', async (t) => {
  const root = await newRoot({ workspaceVersion: 1 });
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);

  await assert.rejects(
    table.add(deps, { name: 'x', caption: 'c', source: { result: 'RESULT-0123456789' } }),
    { code: 'USAGE', hint: 'run phdude migrate' },
  );
  await assert.rejects(table.build(deps, 'TABLE-0123456789', {}), {
    code: 'USAGE',
    hint: 'run phdude migrate',
  });
});

test('data add then table build: a table renders the dataset the CLI registered', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeFile(join(root, 'data', 'survey.csv'), SURVEY + '\n');

  const registered = await data.add(deps, 'data/survey.csv');
  const { table: declared } = await table.add(deps, {
    name: 'respondents',
    caption: 'Every respondent.',
    source: { dataset: registered.dataset.id },
    formats: ['md'],
  });
  await table.build(deps, declared.id, {});

  const md = await readFile(join(root, 'tables', 'out', 'respondents.md'), 'utf8');
  assert.match(md, /^\| id \| age \| group \| joined \|$/m);
  assert.match(md, /^\| 3 \| {2}\| a \| {2}\|$/m, 'a missing cell renders empty, not undefined');
});

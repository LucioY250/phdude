import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { parseTable } from '../../src/adapters/documents/index.js';
import { read, realpath } from '../../src/adapters/store/fs-walk.js';
import { PhdudeError } from '../../src/domain/errors.js';
import { CURRENT_WORKSPACE_VERSION } from '../../src/domain/versioning.js';
import * as data from '../../src/application/data.js';

const actor = { researcher: 'test', agent: 'node' };

const SURVEY = ['id,age,group,joined', '1,31,a,2026-01-02', '2,44,b,2026-02-03', '3,,a,'].join(
  '\n',
);

function makeDeps(root, startTick = 0) {
  let tick = startTick;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 8, 7, 10, 0, tick++)).toISOString(),
    actor,
    readBytes: (rel) => read(join(root, rel)),
    realpath,
    parseTable,
  };
}

async function newRoot({ workspaceVersion = CURRENT_WORKSPACE_VERSION } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-data-'));
  await mkdir(join(root, 'data'), { recursive: true });
  await writeFile(
    join(root, 'phdude.yaml'),
    [
      'schema: phdude.project',
      'version: 1',
      `workspace_version: ${workspaceVersion}`,
      'title: Data test',
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

async function writeData(root, rel, text) {
  await mkdir(join(root, rel, '..'), { recursive: true });
  await writeFile(join(root, rel), text);
}

async function eventCount(store) {
  return (await store.readEvents()).length;
}

test('add registers a dataset on disk, hashed, formatted and profiled', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeData(root, 'data/survey.csv', SURVEY + '\n');

  const { dataset, created } = await data.add(deps, 'data/survey.csv', {
    description: 'Pilot survey',
    license: 'CC-BY-4.0',
  });

  assert.equal(created, true);
  assert.match(dataset.id, /^DATASET-[0-9a-f]{10}$/);
  assert.equal(dataset.path, 'data/survey.csv');
  assert.equal(dataset.format, 'csv');
  assert.equal(dataset.bytes, Buffer.byteLength(SURVEY + '\n'));
  assert.equal(dataset.state, 'candidate');
  assert.equal(dataset.description, 'Pilot survey');
  assert.equal(dataset.license, 'CC-BY-4.0');
  assert.equal(dataset.sensitive, false);

  const onDisk = parse(
    await readFile(join(root, 'knowledge', 'datasets', `${dataset.id}.yaml`), 'utf8'),
  );
  assert.deepEqual(onDisk, dataset, 'the record on disk is the record returned');
  assert.equal(onDisk.id, `DATASET-${onDisk.hash.slice(0, 10)}`);

  assert.equal(onDisk.profile.rows, 3);
  assert.deepEqual(
    onDisk.profile.columns.map((c) => [c.name, c.inferred_type, c.missing]),
    [
      ['id', 'number', 0],
      ['age', 'number', 1],
      ['group', 'string', 0],
      ['joined', 'date', 1],
    ],
  );
  assert.deepEqual(onDisk.profile.columns[2].samples, ['a', 'b']);

  const events = await deps.store.readEvents();
  assert.equal(events.length, 1, 'one event per registration');
  assert.equal(events[0].op, 'data');
  assert.deepEqual(events[0].ids, [dataset.id]);
});

test('add is a no-op when the same bytes are added again', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeData(root, 'data/survey.csv', SURVEY);

  const first = await data.add(deps, 'data/survey.csv');
  const again = await data.add(deps, './data/survey.csv');

  assert.equal(again.created, false);
  assert.equal(again.dataset.id, first.dataset.id);
  assert.deepEqual(again.dataset, first.dataset);
  assert.equal(await eventCount(deps.store), 1, 'a no-op writes no second event');
  assert.equal((await data.list(deps)).length, 1);
});

test('changed bytes at the same path make a new dataset linked to the first', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeData(root, 'data/survey.csv', SURVEY);
  const first = await data.add(deps, 'data/survey.csv');

  await writeData(root, 'data/survey.csv', SURVEY + '\n4,52,b,2026-03-04');
  const second = await data.add(deps, 'data/survey.csv');

  assert.equal(second.created, true);
  assert.notEqual(second.dataset.id, first.dataset.id);
  assert.equal(second.dataset.versions_of, first.dataset.id);
  assert.equal(second.dataset.latest, true);
  assert.equal(second.dataset.profile.rows, 4);

  const rewritten = await deps.store.readEntity(first.dataset.id);
  assert.equal(rewritten.latest, false, 'the older version is no longer the latest');
  assert.equal(Object.hasOwn(rewritten, 'versions_of'), false, 'the oldest points at nothing');

  const events = await deps.store.readEvents();
  assert.equal(events.length, 2, 'one event for the new version, not one per file written');
  assert.deepEqual(events[1].ids, [second.dataset.id, first.dataset.id]);
});

test('a third version still points at the oldest and is the only latest', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeData(root, 'data/survey.csv', SURVEY);
  const first = await data.add(deps, 'data/survey.csv');
  await writeData(root, 'data/survey.csv', SURVEY + '\n4,52,b,2026-03-04');
  const second = await data.add(deps, 'data/survey.csv');
  await writeData(root, 'data/survey.csv', SURVEY + '\n5,61,a,2026-04-05');
  const third = await data.add(deps, 'data/survey.csv');

  assert.equal(third.dataset.versions_of, first.dataset.id);
  const all = await data.list(deps);
  assert.deepEqual(
    all.filter((d) => d.latest === true).map((d) => d.id),
    [third.dataset.id],
  );
  assert.equal((await deps.store.readEntity(second.dataset.id)).latest, false);
});

test('a dataset at another path is its own record, not a version', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeData(root, 'data/one.csv', 'a,b\n1,2\n');
  await writeData(root, 'data/two.csv', 'a,b\n3,4\n');

  const one = await data.add(deps, 'data/one.csv');
  const two = await data.add(deps, 'data/two.csv');

  assert.notEqual(one.dataset.id, two.dataset.id);
  assert.equal(Object.hasOwn(two.dataset, 'versions_of'), false);
  assert.equal(await eventCount(deps.store), 2);
});

test('a sensitive dataset records counts but no cell samples', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeData(
    root,
    'data/people.csv',
    'name,email\nAda,ada@example.org\nGrace,g@example.org\n',
  );

  const { dataset } = await data.add(deps, 'data/people.csv', { sensitive: true });

  assert.equal(dataset.sensitive, true);
  for (const column of dataset.profile.columns) {
    assert.equal(Object.hasOwn(column, 'samples'), false, `${column.name} leaked samples`);
    assert.equal(column.distinct, 2);
  }
});

test('a tsv, a json array and an unreadable format are all registered', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeData(root, 'data/table.tsv', 'id\tage\n1\t31\n');
  await writeData(root, 'data/rows.json', '[{"id":1,"ok":true},{"id":2,"ok":false}]');
  await writeData(root, 'data/blob.sav', 'not a table');

  const tsv = await data.add(deps, 'data/table.tsv');
  assert.equal(tsv.dataset.format, 'tsv');
  assert.equal(tsv.dataset.profile.rows, 1);

  const json = await data.add(deps, 'data/rows.json');
  assert.equal(json.dataset.format, 'json');
  assert.deepEqual(
    json.dataset.profile.columns.map((c) => [c.name, c.inferred_type]),
    [
      ['id', 'number'],
      ['ok', 'boolean'],
    ],
  );

  const other = await data.add(deps, 'data/blob.sav');
  assert.equal(other.dataset.format, 'other');
  assert.deepEqual(other.dataset.profile, { rows: 0, columns: [] });
  assert.match(other.dataset.hash, /^[0-9a-f]{64}$/);
});

test('add refuses a path outside data/, a missing file and an unknown field', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeData(root, 'data/survey.csv', SURVEY);

  await assert.rejects(
    () => data.add(deps, 'sources/survey.csv'),
    (err) => err instanceof PhdudeError && err.code === 'VALIDATION',
  );
  await assert.rejects(
    () => data.add(deps, 'data/nothing.csv'),
    (err) =>
      err instanceof PhdudeError && err.code === 'VALIDATION' && /not found/.test(err.message),
  );
  await assert.rejects(
    () => data.add(deps, 'data/survey.csv', { sensitve: true }),
    (err) =>
      err instanceof PhdudeError && err.code === 'VALIDATION' && /unknown field/.test(err.message),
  );
  assert.equal(await eventCount(deps.store), 0, 'a refusal writes nothing');
});

test('add refuses a data/ path that is a symlink out of the workspace', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-data-outside-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = await newRoot();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const deps = makeDeps(workspace);

  const secret = join(root, 'secret.csv');
  await writeFile(secret, 'token\nsk-do-not-read\n');
  await symlink(secret, join(workspace, 'data', 'evil.csv'));

  await assert.rejects(
    () => data.add(deps, 'data/evil.csv'),
    (err) =>
      err instanceof PhdudeError &&
      err.code === 'USAGE' &&
      /outside the workspace/.test(err.message),
  );
  assert.deepEqual(await data.list(deps), [], 'the refusal records no dataset');
  assert.equal(await eventCount(deps.store), 0, 'a refusal writes nothing');
});

test('add follows a symlink that stays inside the workspace', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeData(root, 'data/survey.csv', SURVEY);
  await symlink(join(root, 'data', 'survey.csv'), join(root, 'data', 'copy.csv'));

  const { dataset, created } = await data.add(deps, 'data/copy.csv');
  assert.equal(created, true);
  assert.equal(dataset.path, 'data/copy.csv');
  assert.equal(dataset.profile.rows, 3);
});

test('add refuses to write into a workspace that needs migration', async (t) => {
  const root = await newRoot({ workspaceVersion: 1 });
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeData(root, 'data/survey.csv', SURVEY);

  await assert.rejects(
    () => data.add(deps, 'data/survey.csv'),
    (err) =>
      err instanceof PhdudeError && err.code === 'USAGE' && err.hint === 'run phdude migrate',
  );
});

test('list, show and profile read the registered datasets back', async (t) => {
  const root = await newRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await writeData(root, 'data/survey.csv', SURVEY);
  const { dataset } = await data.add(deps, 'data/survey.csv');

  const listed = await data.list(deps);
  assert.deepEqual(
    listed.map((d) => d.id),
    [dataset.id],
  );
  assert.deepEqual(await data.show(deps, dataset.id), dataset);

  const profile = await data.profile(deps, dataset.id);
  assert.equal(profile.id, dataset.id);
  assert.equal(profile.path, 'data/survey.csv');
  assert.equal(profile.format, 'csv');
  assert.equal(profile.rows, 3);
  assert.equal(profile.columns.length, 4);

  await assert.rejects(
    () => data.show(deps, 'CLAIM-0123456789'),
    (err) => err instanceof PhdudeError && err.code === 'USAGE',
  );
  await assert.rejects(
    () => data.show(deps, 'DATASET-0000000000'),
    (err) => err instanceof PhdudeError && err.code === 'USAGE' && /not found/.test(err.message),
  );
});

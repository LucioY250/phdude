import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { addEntity } from '../../src/application/add.js';
import { migrate } from '../../src/application/migrate.js';
import { status } from '../../src/application/status.js';
import { validate } from '../../src/schemas/index.js';
import migration0001 from '../../migrations/0001-workspace-v2.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'workspaces', 'v0.1-minimal');

const ACTOR = { researcher: 'tester', agent: 'test' };
const CLOCK = () => '2026-09-07T00:00:00Z';

function deps(root, { dirty = false } = {}) {
  return {
    store: new FsStore(root),
    git: { isDirty: async () => dirty },
    clock: CLOCK,
    actor: ACTOR,
  };
}

async function fixtureCopy(t) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-migrate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(FIXTURE, root, { recursive: true });
  return root;
}

async function snapshotFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = new Map();
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [rel, text] of await snapshotFiles(abs, base)) files.set(rel, text);
    } else {
      files.set(relative(base, abs).split(sep).join('/'), await readFile(abs, 'utf8'));
    }
  }
  return files;
}

async function migrateEvents(root) {
  const text = await readFile(join(root, '.phdude', 'events.jsonl'), 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((e) => e.op === 'migrate');
}

test('the v0.1 fixture is schema-valid and carries no workspace_version', async () => {
  const store = new FsStore(FIXTURE);
  const project = await store.readProject();
  assert.equal(project.workspace_version, undefined);

  for (const type of ['artifact', 'source', 'claim', 'evidence', 'fact', 'question']) {
    const objs = await store.listEntities(type);
    assert.equal(objs.length, 1, `the fixture has one ${type}`);
    const result = validate(type, objs[0]);
    assert.ok(result.ok, `${objs[0].id}: ${result.errors?.join('; ')}`);
  }
});

test('migrate --dry-run lists the files that would change and writes nothing', async (t) => {
  const root = await fixtureCopy(t);
  const before = await snapshotFiles(root);

  const result = await migrate(deps(root), { dryRun: true });

  assert.equal(result.from, 1);
  assert.equal(result.to, 2);
  assert.equal(result.applied, false);
  assert.equal(result.steps.length, 1);
  assert.deepEqual(result.steps[0].changed.sort(), [
    'knowledge/claims/CLAIM-bb244df965.yaml',
    'knowledge/evidence/EVID-02756876a5.yaml',
    'phdude.yaml',
  ]);
  assert.match(result.steps[0].description, /provenance/);

  assert.deepEqual([...(await snapshotFiles(root))], [...before], 'dry run changes no file');
});

test('migrate rewrites claims and evidence, sets workspace_version and records one event', async (t) => {
  const root = await fixtureCopy(t);

  const result = await migrate(deps(root));
  assert.equal(result.applied, true);
  assert.deepEqual(result.steps[0].changed.sort(), [
    'knowledge/claims/CLAIM-bb244df965.yaml',
    'knowledge/evidence/EVID-02756876a5.yaml',
    'phdude.yaml',
  ]);

  const store = new FsStore(root);
  assert.equal((await store.readProject()).workspace_version, 2);

  const [claim] = await store.listEntities('claim');
  assert.deepEqual(claim.provenance, { method: 'imported', derived_from: [] });
  assert.deepEqual(claim.contradicts, []);
  assert.equal(
    claim.statement,
    'Archived lab notebook coverage is uneven across the 2019 field sites.',
  );

  const [evidence] = await store.listEntities('evidence');
  assert.deepEqual(evidence.provenance, { method: 'imported', derived_from: [] });
  assert.equal(evidence.contradicts, undefined, 'contradicts belongs to claims only');

  const events = await migrateEvents(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].summary, `1 → 2: ${result.steps[0].description}`);
  assert.deepEqual(events[0].ids, []);
});

test('migrating an already-current workspace changes nothing and records no event', async (t) => {
  const root = await fixtureCopy(t);
  await migrate(deps(root));
  const after = await snapshotFiles(root);

  const second = await migrate(deps(root));
  assert.equal(second.applied, false);
  assert.deepEqual(second.steps, []);
  assert.equal(second.from, 2);

  assert.deepEqual([...(await snapshotFiles(root))], [...after]);
  assert.equal((await migrateEvents(root)).length, 1);
});

test('migration 0001 is idempotent: applying it twice reports no second change', async (t) => {
  const root = await fixtureCopy(t);
  const store = new FsStore(root);

  const first = await migration0001.apply(store);
  assert.ok(first.changed.length > 0);
  const after = await snapshotFiles(root);

  const second = await migration0001.apply(store);
  assert.deepEqual(second.changed, []);
  assert.deepEqual([...(await snapshotFiles(root))], [...after]);
});

test('migrate refuses on a dirty git tree and --force overrides it', async (t) => {
  const root = await fixtureCopy(t);

  await assert.rejects(() => migrate(deps(root, { dirty: true })), {
    code: 'POLICY',
    message: 'working tree has uncommitted changes',
    hint: 'commit or stash first, or pass --force',
  });
  assert.equal((await new FsStore(root).readProject()).workspace_version, undefined);

  const dryRun = await migrate(deps(root, { dirty: true }), { dryRun: true });
  assert.equal(dryRun.steps.length, 1, 'a dry run is a read and stays available on a dirty tree');

  const forced = await migrate(deps(root, { dirty: true }), { force: true });
  assert.equal(forced.applied, true);
  assert.equal((await new FsStore(root).readProject()).workspace_version, 2);
});

test('migrate outside a workspace is a usage error', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-migrate-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(() => migrate(deps(root)), { code: 'USAGE', hint: 'run phdude init' });
});

test('a mutating use case refuses an un-migrated workspace and points at migrate', async (t) => {
  const root = await fixtureCopy(t);

  await assert.rejects(() => addEntity(deps(root), 'claim', { statement: 'A brand new claim.' }), {
    code: 'USAGE',
    message: 'workspace needs migration (1 → 2)',
    hint: 'run phdude migrate',
  });

  await migrate(deps(root));
  const { created } = await addEntity(deps(root), 'claim', { statement: 'A brand new claim.' });
  assert.equal(created, true);
});

test('reads still work on an un-migrated workspace and carry the migration warning', async (t) => {
  const root = await fixtureCopy(t);

  const before = await status({ store: new FsStore(root) });
  assert.equal(before.knowledge.byType.claim.total, 1);
  assert.ok(before.warnings.includes('workspace needs migration (1 → 2)'));

  await migrate(deps(root));

  const after = await status({ store: new FsStore(root) });
  assert.deepEqual(after.warnings, []);
});

async function newerFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-newer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(FIXTURE, root, { recursive: true });
  const store = new FsStore(root);
  await store.writeProject({ ...(await store.readProject()), workspace_version: 3 });
  return root;
}

test('a mutating use case refuses a workspace newer than the runtime', async (t) => {
  const root = await newerFixture(t);

  await assert.rejects(() => addEntity(deps(root), 'claim', { statement: 'From an old build.' }), {
    code: 'USAGE',
    message: 'workspace version 3 is newer than this PhDude (2)',
    hint: 'upgrade phdude',
  });
});

test('reads still work on a workspace newer than the runtime and carry the warning', async (t) => {
  const root = await newerFixture(t);

  const report = await status({ store: new FsStore(root) });
  assert.equal(report.knowledge.byType.claim.total, 1);
  assert.ok(report.warnings.includes('workspace version 3 is newer than this PhDude (2)'));
});

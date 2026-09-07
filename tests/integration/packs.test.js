import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { initWorkspace } from '../../src/application/init.js';
import { newArtifact } from '../../src/domain/entities.js';
import { makeId } from '../../src/domain/ids.js';
import { sha256 } from '../../src/domain/hash.js';
import { discoverPacks, DEFAULT_PACKS_DIR } from '../../src/adapters/packs/loader.js';
import { list, detect, apply } from '../../src/application/packs.js';
import { PhdudeError } from '../../src/domain/errors.js';

const actor = { researcher: 'test', agent: 'node' };

function makeDeps(root) {
  let tick = 0;
  return {
    store: new FsStore(root),
    git: {
      isInsideRepo: async () => false,
      initRepo: async () => {},
      userName: async () => 'tester',
    },
    agentHosts: [],
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
    actor,
  };
}

async function newWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'phdude-packs-'));
  const deps = makeDeps(root);
  await initWorkspace(deps, { title: 'Quant thesis', agents: [], noGit: true });
  return { root, deps: { ...deps, loadPacks: () => discoverPacks([DEFAULT_PACKS_DIR]) } };
}

async function addArtifactWithText(store, clock, text) {
  const bytes = Buffer.from(text, 'utf8');
  const id = makeId('artifact', bytes);
  const artifact = newArtifact({
    id,
    path: 'sources/study.md',
    hash: sha256(bytes),
    bytes: bytes.length,
    kind: 'md',
    mtime: clock(),
    actor,
    created: clock(),
  });
  await store.writeEntity(artifact);
  await store.writeTextAtomic(join('.phdude', 'cache', id, 'text.md'), text);
  return artifact;
}

const QUANT_TEXT = `
We ran a linear regression and report the p-value alongside effect sizes.
An ANOVA confirmed significance across groups; the survey used Likert items.
Cronbach's alpha assessed reliability; we also report variance and correlation
across the sample.
`;

test('list shows every shipped pack with applied: false before any pack is applied', async () => {
  const { deps } = await newWorkspace();
  const summary = await list(deps);
  assert.ok(summary.length >= 7);
  const quantitative = summary.find((p) => p.name === 'quantitative');
  assert.deepEqual(quantitative, {
    name: 'quantitative',
    kind: 'method',
    description: quantitative.description,
    applied: false,
  });
});

test('detect scores cached artifact text, writes packs_recommended once, and records one event', async () => {
  const { deps } = await newWorkspace();
  await addArtifactWithText(deps.store, deps.clock, QUANT_TEXT);

  const result = await detect(deps);
  assert.ok(result.recommended.includes('quantitative'));
  assert.ok(result.scores.some((s) => s.name === 'quantitative'));

  const project = await deps.store.readProject();
  assert.deepEqual(project.packs_recommended, result.recommended);

  const events = await deps.store.readEvents();
  const packsEvents = events.filter((e) => e.op === 'packs');
  assert.equal(packsEvents.length, 1);
  assert.match(packsEvents[0].summary, /^recommended: /);

  const second = await detect(deps);
  assert.deepEqual(second.recommended, result.recommended);
  const eventsAfterSecond = await deps.store.readEvents();
  assert.equal(eventsAfterSecond.filter((e) => e.op === 'packs').length, 1);
});

test('detect on a fresh empty workspace recommends none and makes no write or event (unchanged)', async () => {
  const { deps } = await newWorkspace();
  const result = await detect(deps);
  assert.deepEqual(result.recommended, []);
  const project = await deps.store.readProject();
  assert.equal(project.packs_recommended, undefined);
  const events = await deps.store.readEvents();
  assert.equal(events.filter((e) => e.op === 'packs').length, 0);
});

test('detect records "recommended: none" when a prior recommendation no longer holds', async () => {
  const { deps } = await newWorkspace();
  const project = await deps.store.readProject();
  await deps.store.writeProject({ ...project, packs_recommended: ['humanities'] });

  const result = await detect(deps);
  assert.deepEqual(result.recommended, []);

  const events = await deps.store.readEvents();
  const packsEvents = events.filter((e) => e.op === 'packs');
  assert.equal(packsEvents.length, 1);
  assert.equal(packsEvents[0].summary, 'recommended: none');
});

test('apply adds a method pack to phdude.yaml and records an event', async () => {
  const { deps } = await newWorkspace();
  const result = await apply(deps, 'quantitative');
  assert.equal(result.applied, true);
  assert.ok(result.project.methods.includes('quantitative'));

  const onDisk = await deps.store.readProject();
  assert.ok(onDisk.methods.includes('quantitative'));

  const events = await deps.store.readEvents();
  const packsEvents = events.filter((e) => e.op === 'packs');
  assert.equal(packsEvents.length, 1);
  assert.equal(packsEvents[0].summary, 'applied quantitative');
});

test('apply is idempotent: a second apply makes no write and no new event', async () => {
  const { deps } = await newWorkspace();
  await apply(deps, 'quantitative');
  const second = await apply(deps, 'quantitative');
  assert.deepEqual(second, { applied: false });

  const events = await deps.store.readEvents();
  assert.equal(events.filter((e) => e.op === 'packs').length, 1);
});

test('apply adds a field pack to the fields list', async () => {
  const { deps } = await newWorkspace();
  const result = await apply(deps, 'computer-science');
  assert.ok(result.project.fields.includes('computer-science'));
});

test('apply raises VALIDATION when the project already lists the pack under the wrong collection', async () => {
  const { deps } = await newWorkspace();
  const project = await deps.store.readProject();
  await deps.store.writeProject({ ...project, fields: ['quantitative'] });

  await assert.rejects(
    () => apply(deps, 'quantitative'),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /quantitative is listed under fields.*method pack/);
      return true;
    },
  );

  const onDisk = await deps.store.readProject();
  assert.deepEqual(onDisk.methods, []);
  const events = await deps.store.readEvents();
  assert.equal(events.filter((e) => e.op === 'packs').length, 0);
});

test('apply of an unknown pack raises USAGE', async () => {
  const { deps } = await newWorkspace();
  await assert.rejects(
    () => apply(deps, 'nope'),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'USAGE');
      assert.match(err.message, /unknown pack nope/);
      return true;
    },
  );
});

test('list reports applied: true once a pack has been applied', async () => {
  const { deps } = await newWorkspace();
  await apply(deps, 'quantitative');
  const summary = await list(deps);
  const quantitative = summary.find((p) => p.name === 'quantitative');
  assert.equal(quantitative.applied, true);
  const qualitative = summary.find((p) => p.name === 'qualitative');
  assert.equal(qualitative.applied, false);
});

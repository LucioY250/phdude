import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { copySkills, initWorkspace } from '../../src/application/init.js';

const deps = (root) => ({
  store: new FsStore(root),
  git: {
    isInsideRepo: async () => false,
    initRepo: async () => {},
    userName: async () => 'tester',
  },
  agentHosts: [],
  clock: () => '2026-09-07T00:00:00Z',
  actor: { researcher: 'tester', agent: 'test' },
});

test('init creates layout and is idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const r1 = await initWorkspace(deps(root), { title: 'My thesis', agents: [] });
  for (const p of [
    'phdude.yaml',
    '.phdude/constitution.yaml',
    '.phdude/events.jsonl',
    'knowledge/claims/.gitkeep',
    'sources/.gitkeep',
    '.gitignore',
  ])
    await stat(join(root, p));
  assert.ok(r1.created.includes('phdude.yaml'));
  assert.equal(r1.gitInitialized, true);
  const r2 = await initWorkspace(deps(root), { title: 'Other', agents: [] });
  assert.equal(r2.created.length, 0);
  assert.match(await readFile(join(root, 'phdude.yaml'), 'utf8'), /title: My thesis/);
  const events = (await readFile(join(root, '.phdude/events.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(events.length, 2);
});

test('init creates the authors dir for per-researcher voice profiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  await initWorkspace(deps(root), { title: 'My thesis', agents: [] });
  await stat(join(root, 'authors/.gitkeep'));
});

test('noGit: true skips git entirely and gitInitialized is false', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  let initRepoCalled = false;
  const d = deps(root);
  d.git = {
    isInsideRepo: async () => false,
    initRepo: async () => {
      initRepoCalled = true;
    },
    userName: async () => 'tester',
  };
  const r = await initWorkspace(d, { title: 'My thesis', agents: [], noGit: true });
  assert.equal(r.gitInitialized, false);
  assert.equal(initRepoCalled, false);
});

test('with agents: [] and no agentHosts, phdude.yaml has agents: [] and mode: full', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const d = deps(root);
  d.agentHosts = [];
  await initWorkspace(d, { title: 'My thesis', agents: [] });
  const text = await readFile(join(root, 'phdude.yaml'), 'utf8');
  assert.match(text, /agents: \[\]/);
  assert.match(text, /mode: full/);
});

test('copySkills classifies created, then skipped, then updated on content change', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  const srcDir = await mkdtemp(join(tmpdir(), 'phdude-skills-src-'));
  await mkdir(join(srcDir, 'demo', 'references'), { recursive: true });
  await writeFile(join(srcDir, 'demo', 'SKILL.md'), '# demo skill\n');
  await writeFile(join(srcDir, 'demo', 'references', 'a.md'), 'reference a\n');

  const skillPath = join('.phdude', 'skills', 'demo', 'SKILL.md');
  const refPath = join('.phdude', 'skills', 'demo', 'references', 'a.md');

  const r1 = { created: [], updated: [], skipped: [] };
  await copySkills(store, srcDir, r1.created, r1.updated, r1.skipped);
  assert.deepEqual(r1.created.sort(), [refPath, skillPath].sort());
  assert.equal(r1.updated.length, 0);
  assert.equal(r1.skipped.length, 0);

  const r2 = { created: [], updated: [], skipped: [] };
  await copySkills(store, srcDir, r2.created, r2.updated, r2.skipped);
  assert.equal(r2.created.length, 0);
  assert.equal(r2.updated.length, 0);
  assert.deepEqual(r2.skipped.sort(), [refPath, skillPath].sort());

  await writeFile(join(srcDir, 'demo', 'references', 'a.md'), 'reference a, revised\n');
  const r3 = { created: [], updated: [], skipped: [] };
  await copySkills(store, srcDir, r3.created, r3.updated, r3.skipped);
  assert.equal(r3.created.length, 0);
  assert.deepEqual(r3.updated, [refPath]);
  assert.deepEqual(r3.skipped, [skillPath]);
});

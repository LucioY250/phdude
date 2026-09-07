import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { copySkills, initWorkspace } from '../../src/application/init.js';
import { discoverSkills } from '../../src/adapters/skills/loader.js';
import { codexHost } from '../../src/adapters/agents/codex.js';
import { claudeCodeHost } from '../../src/adapters/agents/claude-code.js';
import { PhdudeError } from '../../src/domain/errors.js';

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
  discoverSkills,
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

test('agents: [codex] installs codexHost and produces AGENTS.md', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const d = deps(root);
  d.agentHosts = [codexHost];
  const r1 = await initWorkspace(d, { title: 'My thesis', agents: ['codex'] });
  await stat(join(root, 'AGENTS.md'));
  assert.ok(r1.created.includes('AGENTS.md'));
  assert.match(await readFile(join(root, 'AGENTS.md'), 'utf8'), /phdude/i);

  const r2 = await initWorkspace(d, { title: 'My thesis', agents: ['codex'] });
  assert.ok(!r2.created.includes('AGENTS.md'));
  assert.ok(!r2.updated.includes('AGENTS.md'));
  assert.ok(r2.skipped.includes('AGENTS.md'));
});

test('agents: [claude-code, codex] reports AGENTS.md exactly once, never in two lists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const d = deps(root);
  d.agentHosts = [claudeCodeHost, codexHost];
  const count = (r, rel) =>
    [r.created, r.updated, r.skipped].filter((list) => list.includes(rel)).length;

  const r1 = await initWorkspace(d, { title: 'My thesis', agents: ['claude-code', 'codex'] });
  assert.equal(count(r1, 'AGENTS.md'), 1);
  assert.ok(r1.created.includes('AGENTS.md'));
  assert.match(await readFile(join(root, 'AGENTS.md'), 'utf8'), /<!-- phdude:skills-index -->/);

  const r2 = await initWorkspace(d, { title: 'My thesis', agents: ['claude-code', 'codex'] });
  assert.equal(count(r2, 'AGENTS.md'), 1);
  assert.ok(r2.skipped.includes('AGENTS.md'));
  assert.ok(!r2.created.includes('AGENTS.md'));
  assert.ok(!r2.updated.includes('AGENTS.md'));
});

test('copySkills classifies created, then skipped, then updated on content change', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  const srcDir = await mkdtemp(join(tmpdir(), 'phdude-skills-src-'));
  await mkdir(join(srcDir, 'demo', 'references'), { recursive: true });
  await writeFile(
    join(srcDir, 'demo', 'SKILL.md'),
    [
      '---',
      'name: demo',
      'description: a demo skill for copySkills tests',
      '---',
      '# demo skill',
    ].join('\n'),
  );
  await writeFile(join(srcDir, 'demo', 'references', 'a.md'), 'reference a\n');

  const skillPath = join('.phdude', 'skills', 'demo', 'SKILL.md');
  const refPath = join('.phdude', 'skills', 'demo', 'references', 'a.md');

  const r1 = { created: [], updated: [], skipped: [] };
  await copySkills(store, srcDir, r1.created, r1.updated, r1.skipped, { discoverSkills });
  assert.deepEqual(r1.created.sort(), [refPath, skillPath].sort());
  assert.equal(r1.updated.length, 0);
  assert.equal(r1.skipped.length, 0);

  const r2 = { created: [], updated: [], skipped: [] };
  await copySkills(store, srcDir, r2.created, r2.updated, r2.skipped, { discoverSkills });
  assert.equal(r2.created.length, 0);
  assert.equal(r2.updated.length, 0);
  assert.deepEqual(r2.skipped.sort(), [refPath, skillPath].sort());

  await writeFile(join(srcDir, 'demo', 'references', 'a.md'), 'reference a, revised\n');
  const r3 = { created: [], updated: [], skipped: [] };
  await copySkills(store, srcDir, r3.created, r3.updated, r3.skipped, { discoverSkills });
  assert.equal(r3.created.length, 0);
  assert.deepEqual(r3.updated, [refPath]);
  assert.deepEqual(r3.skipped, [skillPath]);
});

async function writeSkillFile(
  dir,
  name,
  { permissions = 'network: none\n    workspace: [read]' } = {},
) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    [
      '---',
      `name: ${name}`,
      `description: a ${name} skill`,
      'phdude:',
      '  version: 1',
      '  reads: []',
      '  writes: []',
      '  permissions:',
      `    ${permissions}`,
      '---',
      `# ${name}`,
    ].join('\n'),
  );
}

test('copySkills validates every skill before copying and copies nothing when one is invalid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  const srcDir = await mkdtemp(join(tmpdir(), 'phdude-skills-src-'));
  await writeSkillFile(join(srcDir, 'good'), 'good');
  await mkdir(join(srcDir, 'bad'), { recursive: true });
  await writeFile(
    join(srcDir, 'bad', 'SKILL.md'),
    [
      '---',
      'name: bad',
      'description: a bad skill',
      'phdude:',
      '  version: 2',
      '---',
      '# bad',
    ].join('\n'),
  );

  await assert.rejects(
    () => copySkills(store, srcDir, [], [], [], { discoverSkills }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /skill bad/);
      return true;
    },
  );
  assert.equal(await store.exists(join('.phdude', 'skills', 'good', 'SKILL.md')), false);
});

test('copySkills refuses a skill that requests network access unless the policy allows it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  const srcDir = await mkdtemp(join(tmpdir(), 'phdude-skills-src-'));
  await writeSkillFile(join(srcDir, 'networked'), 'networked', {
    permissions: 'network: allowed\n    workspace: [read]',
  });

  await assert.rejects(
    () => copySkills(store, srcDir, [], [], [], { policy: null, discoverSkills }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'POLICY');
      assert.equal(err.message, 'skill networked requests network access');
      return true;
    },
  );
  assert.equal(await store.exists(join('.phdude', 'skills', 'networked', 'SKILL.md')), false);

  const created = [];
  await copySkills(store, srcDir, created, [], [], {
    policy: { skills: { allow_network: true } },
    discoverSkills,
  });
  assert.ok(created.includes(join('.phdude', 'skills', 'networked', 'SKILL.md')));
});

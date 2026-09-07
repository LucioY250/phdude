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

test('the workspace .gitignore ignores every regenerable out/ directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  await initWorkspace(deps(root), { title: 'My thesis', agents: [] });

  const lines = (await readFile(join(root, '.gitignore'), 'utf8')).split('\n');
  for (const dir of ['outputs', 'analysis/out', 'tables/out', 'figures/out']) {
    assert.ok(lines.includes(`${dir}/*`), `${dir} is ignored`);
    assert.ok(lines.includes(`!${dir}/.gitkeep`), `${dir} keeps its .gitkeep`);
  }
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

test('copySkills withholds a networked skill unless the policy allows it, and installs the rest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  const srcDir = await mkdtemp(join(tmpdir(), 'phdude-skills-src-'));
  await writeSkillFile(join(srcDir, 'networked'), 'networked', {
    permissions: 'network: allowed\n    workspace: [read]',
  });
  await writeSkillFile(join(srcDir, 'quiet'), 'quiet');

  const created = [];
  const result = await copySkills(store, srcDir, created, [], [], {
    policy: null,
    discoverSkills,
  });

  assert.deepEqual(result.withheld, [
    {
      name: 'networked',
      reason: 'skill networked requests network access',
      hint: 'set skills.allow_network: true in .phdude/research-policy.yaml',
    },
  ]);
  assert.deepEqual(result.installed, ['quiet']);
  assert.equal(await store.exists(join('.phdude', 'skills', 'networked', 'SKILL.md')), false);
  assert.ok(
    created.includes(join('.phdude', 'skills', 'quiet', 'SKILL.md')),
    'the other skills are still installed',
  );

  const allowed = [];
  const second = await copySkills(store, srcDir, allowed, [], [], {
    policy: { skills: { allow_network: true } },
    discoverSkills,
  });
  assert.deepEqual(second.withheld, []);
  assert.ok(allowed.includes(join('.phdude', 'skills', 'networked', 'SKILL.md')));
});

test('init installs every skill but the networked one, and says which it withheld', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  const result = await initWorkspace(
    { ...deps(root), store, agentHosts: [claudeCodeHost, codexHost] },
    { title: 'A default workspace', noGit: true },
  );

  assert.deepEqual(
    result.withheldSkills.map((entry) => entry.name),
    ['analysis', 'figures', 'research'],
    'the default policy leaves skills.allow_network and skills.allow_execution false',
  );
  assert.equal(await store.exists(join('.phdude', 'skills', 'research', 'SKILL.md')), false);
  assert.equal(await store.exists(join('.phdude', 'skills', 'analysis', 'SKILL.md')), false);
  assert.equal(await store.exists(join('.phdude', 'skills', 'figures', 'SKILL.md')), false);
  assert.equal(await store.exists(join('.phdude', 'skills', 'literature', 'SKILL.md')), true);

  // A withheld skill is withheld from the agent-facing files too, or the agent goes looking
  // for a SKILL.md that was deliberately not installed.
  const agentsMd = await store.readText('AGENTS.md');
  assert.ok(agentsMd.includes('**literature**'));
  assert.ok(!agentsMd.includes('**research**'));
  assert.ok(!agentsMd.includes('**analysis**'));
  assert.ok(!agentsMd.includes('**figures**'));

  // The slash command is still installed: the CLI command exists whatever the skill policy
  // says, and it enforces `network.enabled` on its own.
  assert.equal(await store.exists(join('.claude', 'commands', 'phdude-research.md')), true);
});

test('init installs the research skill once the policy allows network skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  const hostDeps = { ...deps(root), store, agentHosts: [codexHost] };
  await initWorkspace(hostDeps, { title: 'An open workspace', noGit: true });

  const policyPath = join('.phdude', 'research-policy.yaml');
  const policy = await store.readText(policyPath);
  await store.writeTextAtomic(
    policyPath,
    policy.replace('allow_network: false', 'allow_network: true'),
  );

  const result = await initWorkspace(hostDeps, { title: 'An open workspace', noGit: true });
  assert.deepEqual(
    result.withheldSkills.map((entry) => entry.name),
    ['analysis', 'figures'],
    'one setting opens one permission; execution is still closed',
  );
  assert.equal(await store.exists(join('.phdude', 'skills', 'research', 'SKILL.md')), true);
});

test('init installs the analysis skill once the policy allows execution skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  const hostDeps = { ...deps(root), store, agentHosts: [codexHost] };
  await initWorkspace(hostDeps, { title: 'An executing workspace', noGit: true });

  const policyPath = join('.phdude', 'research-policy.yaml');
  await store.writeTextAtomic(
    policyPath,
    (await store.readText(policyPath))
      .replace('allow_network: false', 'allow_network: true')
      .replace('allow_execution: false', 'allow_execution: true'),
  );

  const result = await initWorkspace(hostDeps, { title: 'An executing workspace', noGit: true });
  assert.deepEqual(result.withheldSkills, []);
  assert.equal(await store.exists(join('.phdude', 'skills', 'analysis', 'SKILL.md')), true);
  assert.equal(await store.exists(join('.phdude', 'skills', 'figures', 'SKILL.md')), true);
});

test('init takes an installed skill back off disk when the policy closes again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  const hostDeps = { ...deps(root), store, agentHosts: [codexHost] };
  const policyPath = join('.phdude', 'research-policy.yaml');
  const skillPath = join('.phdude', 'skills', 'research', 'SKILL.md');

  await initWorkspace(hostDeps, { title: 'An open workspace', noGit: true });
  await store.writeTextAtomic(
    policyPath,
    (await store.readText(policyPath)).replace('allow_network: false', 'allow_network: true'),
  );
  const opened = await initWorkspace(hostDeps, { title: 'An open workspace', noGit: true });
  assert.deepEqual(opened.removed, []);
  assert.equal(await store.exists(skillPath), true);

  // Withdrawing the permission has to withdraw the skill: de-indexing it from AGENTS.md alone
  // would leave the file for anything that reads `.phdude/skills/` directly.
  await store.writeTextAtomic(
    policyPath,
    (await store.readText(policyPath)).replace('allow_network: true', 'allow_network: false'),
  );
  const closed = await initWorkspace(hostDeps, { title: 'An open workspace', noGit: true });

  assert.deepEqual(closed.removed, [join('.phdude', 'skills', 'research')]);
  assert.equal(await store.exists(skillPath), false);
  assert.equal(await store.exists(join('.phdude', 'skills', 'research')), false);
  assert.deepEqual(
    closed.withheldSkills.map((entry) => entry.name),
    ['analysis', 'figures', 'research'],
  );

  // Every other skill is untouched, and a third run has nothing left to remove.
  assert.equal(await store.exists(join('.phdude', 'skills', 'phdude-core', 'SKILL.md')), true);
  assert.deepEqual(
    (await initWorkspace(hostDeps, { title: 'An open workspace', noGit: true })).removed,
    [],
  );
});

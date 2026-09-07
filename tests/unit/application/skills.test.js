import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { assertSkillPolicyOk, listSkills } from '../../../src/application/skills.js';
import { discoverSkills } from '../../../src/adapters/skills/loader.js';
import { DEFAULT_SKILLS_DIR } from '../../../src/adapters/agents/shared.js';
import { discoverPacks, DEFAULT_PACKS_DIR } from '../../../src/adapters/packs/loader.js';
import { PhdudeError } from '../../../src/domain/errors.js';

test('assertSkillPolicyOk allows a skill that does not request network access', () => {
  assertSkillPolicyOk({ name: 'read-only', contract: { permissions: { network: 'none' } } }, null);
});

test('assertSkillPolicyOk rejects a networked skill when the policy is absent or disallows it', () => {
  for (const policy of [null, undefined, {}, { skills: { allow_network: false } }]) {
    assert.throws(
      () =>
        assertSkillPolicyOk(
          { name: 'net', contract: { permissions: { network: 'allowed' } } },
          policy,
        ),
      (err) => {
        assert.ok(err instanceof PhdudeError);
        assert.equal(err.code, 'POLICY');
        assert.equal(err.message, 'skill net requests network access');
        assert.equal(err.hint, 'set skills.allow_network: true in .phdude/research-policy.yaml');
        return true;
      },
    );
  }
});

test('assertSkillPolicyOk allows a networked skill once the workspace policy opts in', () => {
  assertSkillPolicyOk(
    { name: 'net', contract: { permissions: { network: 'allowed' } } },
    { skills: { allow_network: true } },
  );
});

const emptyStore = { root: '/nonexistent-phdude-workspace', readYaml: async () => null };

test('listSkills reports the shipped core skills with source "core" and their declared permissions', async () => {
  const { skills, warnings } = await listSkills({
    store: emptyStore,
    loadPacks: async () => [],
    discoverSkills,
    skillsDir: DEFAULT_SKILLS_DIR,
  });
  assert.deepEqual(warnings, []);
  const bootstrap = skills.find((s) => s.name === 'bootstrap');
  assert.ok(bootstrap, 'bootstrap is a shipped core skill');
  assert.equal(bootstrap.source, 'core');
  assert.deepEqual(bootstrap.permissions, { network: 'none', workspace: ['read'] });
  assert.deepEqual(bootstrap.reads, ['sources/**', '.phdude/cache/**', 'knowledge/artifacts/**']);
  assert.deepEqual(bootstrap.writes, []);
  assert.deepEqual(bootstrap.warnings, []);
});

test('listSkills records a pack skill with source "pack:<name>"', async () => {
  const { skills } = await listSkills({
    store: emptyStore,
    loadPacks: () => discoverPacks([DEFAULT_PACKS_DIR]),
    discoverSkills,
    skillsDir: DEFAULT_SKILLS_DIR,
  });
  const quantitative = skills.find((s) => s.name === 'quantitative');
  assert.ok(quantitative, 'the quantitative method pack skill is listed');
  assert.equal(quantitative.source, 'pack:quantitative');
});

// The three doctor behaviours deferred out of tasks 2 and 3: a workspace copy of a shipped
// skill is still `core`, one unloadable skill costs one warning rather than the whole listing,
// and a skill the policy has not cleared for network access is reported, not refused.
async function workspaceWith(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-listskills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), text);
  }
  return {
    root,
    readYaml: async (rel) => {
      try {
        return parse(await readFile(join(root, rel), 'utf8'));
      } catch {
        return null;
      }
    },
  };
}

const skillMd = (name, { network = 'none' } = {}) =>
  [
    '---',
    `name: ${name}`,
    `description: the ${name} skill`,
    'phdude:',
    '  version: 1',
    '  reads: []',
    '  writes: []',
    '  permissions:',
    `    network: ${network}`,
    '    workspace: [read]',
    '---',
    '',
    `# ${name}`,
    '',
  ].join('\n');

test('listSkills calls a byte-identical workspace copy of a shipped skill "core"', async (t) => {
  const shipped = await readFile(join(DEFAULT_SKILLS_DIR, 'next', 'SKILL.md'), 'utf8');
  const store = await workspaceWith(t, {
    '.phdude/skills/next/SKILL.md': shipped,
    '.phdude/skills/knowledge/SKILL.md': `${await readFile(join(DEFAULT_SKILLS_DIR, 'knowledge', 'SKILL.md'), 'utf8')}\n<!-- edited locally -->\n`,
  });

  const { skills } = await listSkills({
    store,
    loadPacks: async () => [],
    discoverSkills,
    skillsDir: DEFAULT_SKILLS_DIR,
  });

  assert.equal(skills.find((s) => s.name === 'next').source, 'core');
  assert.equal(skills.find((s) => s.name === 'knowledge').source, 'workspace');
});

test('listSkills isolates one unloadable skill and still lists the others', async (t) => {
  const store = await workspaceWith(t, {
    '.phdude/skills/broken/SKILL.md': '---\nname: wrong-name\ndescription: x\n---\n',
    '.phdude/skills/fine/SKILL.md': skillMd('fine'),
  });

  const { skills, warnings } = await listSkills({
    store,
    loadPacks: async () => [],
    discoverSkills,
    skillsDir: DEFAULT_SKILLS_DIR,
  });

  assert.ok(skills.some((s) => s.name === 'fine'));
  assert.ok(
    skills.some((s) => s.name === 'bootstrap'),
    'the core skills survive',
  );
  assert.ok(!skills.some((s) => s.name === 'broken'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^skill broken \(workspace\) could not be loaded: /);
});

test('listSkills warns, and does not throw, on a skill the network policy has not allowed', async (t) => {
  const store = await workspaceWith(t, {
    '.phdude/skills/searcher/SKILL.md': skillMd('searcher', { network: 'allowed' }),
  });

  const { skills, warnings } = await listSkills({
    store,
    loadPacks: async () => [],
    discoverSkills,
    skillsDir: DEFAULT_SKILLS_DIR,
  });

  assert.ok(
    skills.some((s) => s.name === 'searcher'),
    'the skill is still listed',
  );
  assert.deepEqual(warnings, [
    'skill searcher requests network access; set skills.allow_network: true in .phdude/research-policy.yaml',
  ]);
});

test('listSkills stays quiet once the workspace policy allows network access', async (t) => {
  const store = await workspaceWith(t, {
    '.phdude/skills/searcher/SKILL.md': skillMd('searcher', { network: 'allowed' }),
    '.phdude/research-policy.yaml': 'skills:\n  allow_network: true\n',
  });

  const { warnings } = await listSkills({
    store,
    loadPacks: async () => [],
    discoverSkills,
    skillsDir: DEFAULT_SKILLS_DIR,
  });

  assert.deepEqual(warnings, []);
});

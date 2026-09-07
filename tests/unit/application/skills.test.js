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

test('assertSkillPolicyOk rejects an executing skill when the policy is absent or disallows it', () => {
  for (const policy of [null, undefined, {}, { skills: { allow_execution: false } }]) {
    assert.throws(
      () =>
        assertSkillPolicyOk(
          {
            name: 'analysis',
            contract: { permissions: { network: 'none', execution: 'allowed' } },
          },
          policy,
        ),
      (err) => {
        assert.ok(err instanceof PhdudeError);
        assert.equal(err.code, 'POLICY');
        assert.equal(err.message, 'skill analysis requests script execution');
        assert.equal(err.hint, 'set skills.allow_execution: true in .phdude/research-policy.yaml');
        return true;
      },
    );
  }
});

test('assertSkillPolicyOk allows an executing skill once the workspace policy opts in', () => {
  assertSkillPolicyOk(
    { name: 'analysis', contract: { permissions: { network: 'none', execution: 'allowed' } } },
    { skills: { allow_execution: true } },
  );
});

test('allowing network access does not allow script execution', () => {
  const skill = {
    name: 'both',
    contract: { permissions: { network: 'allowed', execution: 'allowed' } },
  };
  assert.throws(() => assertSkillPolicyOk(skill, { skills: { allow_network: true } }), {
    message: 'skill both requests script execution',
  });
  assert.throws(() => assertSkillPolicyOk(skill, { skills: { allow_execution: true } }), {
    message: 'skill both requests network access',
  });
  assertSkillPolicyOk(skill, { skills: { allow_network: true, allow_execution: true } });
});

const emptyStore = { root: '/nonexistent-phdude-workspace', readYaml: async () => null };

test('listSkills reports the shipped core skills with source "core" and their declared permissions', async () => {
  const { skills, warnings } = await listSkills({
    store: emptyStore,
    loadPacks: async () => [],
    discoverSkills,
    skillsDir: DEFAULT_SKILLS_DIR,
  });
  // `research` declares network access; `analysis` and `figures` declare script execution,
  // because both drive a command that spawns one. A workspace with no policy (the default,
  // closed) reports all three - and still lists every skill.
  assert.deepEqual(warnings, [
    'skill analysis requests script execution; set skills.allow_execution: true in .phdude/research-policy.yaml',
    'skill figures requests script execution; set skills.allow_execution: true in .phdude/research-policy.yaml',
    'skill research requests network access; set skills.allow_network: true in .phdude/research-policy.yaml',
  ]);
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

const skillMd = (name, { network = 'none', execution = 'none' } = {}) =>
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
    `    execution: ${execution}`,
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
  const loadFailures = warnings.filter((w) => w.includes('could not be loaded'));
  assert.equal(loadFailures.length, 1);
  assert.match(loadFailures[0], /^skill broken \(workspace\) could not be loaded: /);
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
  assert.ok(
    warnings.includes(
      'skill searcher requests network access; set skills.allow_network: true in .phdude/research-policy.yaml',
    ),
  );
});

test('listSkills stays quiet once the workspace policy allows network access', async (t) => {
  const store = await workspaceWith(t, {
    '.phdude/skills/searcher/SKILL.md': skillMd('searcher', { network: 'allowed' }),
    // Both settings, because the shipped `analysis` skill is discovered here too.
    '.phdude/research-policy.yaml': 'skills:\n  allow_network: true\n  allow_execution: true\n',
  });

  const { warnings } = await listSkills({
    store,
    loadPacks: async () => [],
    discoverSkills,
    skillsDir: DEFAULT_SKILLS_DIR,
  });

  assert.deepEqual(warnings, []);
});

test('listSkills warns, and does not throw, on a skill the execution policy has not allowed', async (t) => {
  const store = await workspaceWith(t, {
    '.phdude/skills/analyst/SKILL.md': skillMd('analyst', { execution: 'allowed' }),
  });

  const { skills, warnings } = await listSkills({
    store,
    loadPacks: async () => [],
    discoverSkills,
    skillsDir: DEFAULT_SKILLS_DIR,
  });

  assert.ok(
    skills.some((s) => s.name === 'analyst'),
    'the skill is still listed',
  );
  assert.ok(
    warnings.includes(
      'skill analyst requests script execution; set skills.allow_execution: true in .phdude/research-policy.yaml',
    ),
  );
});

test('listSkills stays quiet once the workspace policy allows script execution', async (t) => {
  const store = await workspaceWith(t, {
    '.phdude/skills/analyst/SKILL.md': skillMd('analyst', { execution: 'allowed' }),
    '.phdude/research-policy.yaml': 'skills:\n  allow_network: true\n  allow_execution: true\n',
  });

  const { warnings } = await listSkills({
    store,
    loadPacks: async () => [],
    discoverSkills,
    skillsDir: DEFAULT_SKILLS_DIR,
  });

  assert.deepEqual(warnings, []);
});

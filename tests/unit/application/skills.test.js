import test from 'node:test';
import assert from 'node:assert/strict';
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

test('listSkills reports the shipped core skills with source "core" and their declared permissions', async () => {
  const skills = await listSkills({
    store: { root: '/nonexistent-phdude-workspace' },
    loadPacks: async () => [],
    discoverSkills,
    skillsDir: DEFAULT_SKILLS_DIR,
  });
  const bootstrap = skills.find((s) => s.name === 'bootstrap');
  assert.ok(bootstrap, 'bootstrap is a shipped core skill');
  assert.equal(bootstrap.source, 'core');
  assert.deepEqual(bootstrap.permissions, { network: 'none', workspace: ['read'] });
  assert.deepEqual(bootstrap.reads, ['sources/**', '.phdude/cache/**', 'knowledge/artifacts/**']);
  assert.deepEqual(bootstrap.writes, []);
  assert.deepEqual(bootstrap.warnings, []);
});

test('listSkills records a pack skill with source "pack:<name>"', async () => {
  const skills = await listSkills({
    store: { root: '/nonexistent-phdude-workspace' },
    loadPacks: () => discoverPacks([DEFAULT_PACKS_DIR]),
    discoverSkills,
    skillsDir: DEFAULT_SKILLS_DIR,
  });
  const quantitative = skills.find((s) => s.name === 'quantitative');
  assert.ok(quantitative, 'the quantitative method pack skill is listed');
  assert.equal(quantitative.source, 'pack:quantitative');
});

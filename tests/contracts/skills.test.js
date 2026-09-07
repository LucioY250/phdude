import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadSkill } from '../../src/adapters/skills/loader.js';
import { DEFAULT_SKILLS_DIR } from '../../src/adapters/agents/shared.js';
import { discoverPacks, DEFAULT_PACKS_DIR } from '../../src/adapters/packs/loader.js';

function coreSkillDirs() {
  return readdirSync(DEFAULT_SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(DEFAULT_SKILLS_DIR, e.name));
}

for (const dir of coreSkillDirs()) {
  test(`core skill ${dir.slice(DEFAULT_SKILLS_DIR.length + 1)} loads and validates against the skill schema`, async () => {
    const skill = await loadSkill(dir);
    assert.equal(typeof skill.name, 'string');
    assert.equal(typeof skill.description, 'string');
    assert.ok(skill.description.length > 0);
    assert.equal(skill.contract.version, 1);
    assert.deepEqual(skill.warnings, [], `${dir} should declare a phdude: contract`);
  });
}

test('every pack skill loads and validates against the skill schema', async () => {
  const packs = await discoverPacks([DEFAULT_PACKS_DIR]);
  assert.ok(packs.length >= 7);
  let checked = 0;
  for (const pack of packs) {
    for (const skillPath of pack.skillPaths) {
      const skill = await loadSkill(dirname(skillPath));
      assert.equal(skill.contract.version, 1);
      assert.deepEqual(skill.warnings, [], `${skillPath} should declare a phdude: contract`);
      checked++;
    }
  }
  assert.ok(checked >= 7, `expected at least one skill per pack, checked ${checked}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSkills, loadSkill } from '../../../src/adapters/skills/loader.js';
import { PhdudeError } from '../../../src/domain/errors.js';

async function writeSkill(dir, name, { front = {}, body = `# ${name}\n` } = {}) {
  await mkdir(dir, { recursive: true });
  const fields = [
    `name: ${front.name ?? name}`,
    `description: ${front.description ?? 'a test skill'}`,
  ];
  if (front.phdude !== undefined) {
    fields.push('phdude:');
    for (const line of front.phdude) fields.push(`  ${line}`);
  }
  await writeFile(join(dir, 'SKILL.md'), ['---', ...fields, '---', body].join('\n'));
}

test('loadSkill throws VALIDATION when the front matter name does not match the directory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-skill-loader-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'my-skill');
  await writeSkill(dir, 'my-skill', { front: { name: 'other-name' } });

  await assert.rejects(
    () => loadSkill(dir),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /my-skill/);
      return true;
    },
  );
});

test('loadSkill applies a least-privilege default contract and a warning when phdude: is absent', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-skill-loader-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'no-contract');
  await writeSkill(dir, 'no-contract');

  const skill = await loadSkill(dir);
  assert.deepEqual(skill.contract, {
    version: 1,
    reads: [],
    writes: [],
    permissions: { network: 'none', workspace: ['read'] },
  });
  assert.deepEqual(skill.warnings, [
    'skill no-contract: no phdude contract, least privilege assumed',
  ]);
});

test('loadSkill throws VALIDATION with the schema errors when the phdude: block is invalid', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-skill-loader-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'bad-version');
  await writeSkill(dir, 'bad-version', {
    front: {
      phdude: [
        'version: 2',
        'reads: []',
        'writes: []',
        'permissions:',
        '  network: none',
        '  workspace: [read]',
      ],
    },
  });

  await assert.rejects(
    () => loadSkill(dir),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /bad-version/);
      assert.equal(err.hint, 'fix the phdude: block in SKILL.md');
      return true;
    },
  );
});

test('loadSkill returns name, description, contract, path, and empty warnings for a valid skill', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-skill-loader-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'valid');
  await writeSkill(dir, 'valid', {
    front: {
      description: 'a valid test skill',
      phdude: [
        'version: 1',
        'reads: [sources/**]',
        'writes: []',
        'permissions:',
        '  network: none',
        '  workspace: [read]',
      ],
    },
  });

  const skill = await loadSkill(dir);
  assert.equal(skill.name, 'valid');
  assert.equal(skill.description, 'a valid test skill');
  assert.equal(skill.path, join(dir, 'SKILL.md'));
  assert.deepEqual(skill.warnings, []);
  assert.deepEqual(skill.contract.reads, ['sources/**']);
});

test('discoverSkills sorts by name and a later root overrides an earlier one with the same name', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-skill-loader-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const coreRoot = join(root, 'core');
  await writeSkill(join(coreRoot, 'zeta'), 'zeta');
  await writeSkill(join(coreRoot, 'alpha'), 'alpha', { front: { description: 'core alpha' } });

  const workspaceRoot = join(root, 'workspace');
  await writeSkill(join(workspaceRoot, 'alpha'), 'alpha', {
    front: { description: 'overridden alpha' },
  });

  const skills = await discoverSkills([
    { dir: coreRoot, source: 'core' },
    { dir: workspaceRoot, source: 'workspace' },
  ]);

  assert.deepEqual(
    skills.map((s) => s.name),
    ['alpha', 'zeta'],
  );
  const alpha = skills.find((s) => s.name === 'alpha');
  assert.equal(alpha.source, 'workspace');
  assert.equal(alpha.description, 'overridden alpha');
  const zeta = skills.find((s) => s.name === 'zeta');
  assert.equal(zeta.source, 'core');
});

test('discoverSkills tolerates a root that does not exist', async () => {
  const skills = await discoverSkills([{ dir: '/nonexistent/phdude-skills-root', source: 'core' }]);
  assert.deepEqual(skills, []);
});

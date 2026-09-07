import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPack } from '../../../src/adapters/packs/loader.js';
import { PhdudeError } from '../../../src/domain/errors.js';

async function writePackYaml(dir, { name = 'demo-pack', skills = ['skills/demo/SKILL.md'] } = {}) {
  const yaml = [
    'schema: phdude.pack',
    'version: 1',
    `name: ${name}`,
    'kind: field',
    'description: test pack',
    'terminology: [a, b, c]',
    'detect:',
    '  keywords: [aaa, bbb, ccc, ddd, eee, fff, ggg, hhh]',
    'reviewers: [x]',
    'recommended_checks: [x, y]',
    `skills: ${JSON.stringify(skills)}`,
    'schemas: []',
  ].join('\n');
  await writeFile(join(dir, 'pack.yaml'), yaml);
}

test('loadPack rejects a skill path that escapes the pack directory via ../', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-packs-loader-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const packDir = join(root, 'pack');
  await mkdir(packDir, { recursive: true });
  await writeFile(join(root, 'outside.md'), '# outside\n');
  await writePackYaml(packDir, { skills: ['../outside.md'] });

  await assert.rejects(
    () => loadPack(packDir),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /escapes/);
      return true;
    },
  );
});

test('loadPack rejects an absolute skill path outright, even one that resolves inside the pack dir', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-packs-loader-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const packDir = join(root, 'pack');
  await mkdir(join(packDir, 'skills', 'demo'), { recursive: true });
  await writeFile(join(packDir, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\n');
  const absPath = join(packDir, 'skills', 'demo', 'SKILL.md');
  await writePackYaml(packDir, { skills: [absPath] });

  await assert.rejects(
    () => loadPack(packDir),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /escapes/);
      return true;
    },
  );
});

test('loadPack rejects a skill path that resolves to the pack directory itself', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-packs-loader-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const packDir = join(root, 'pack');
  await mkdir(packDir, { recursive: true });
  await writePackYaml(packDir, { skills: ['.'] });

  await assert.rejects(
    () => loadPack(packDir),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /escapes/);
      return true;
    },
  );
});

test('loadPack still accepts a normal relative skill path inside the pack dir', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-packs-loader-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const packDir = join(root, 'pack');
  await mkdir(join(packDir, 'skills', 'demo'), { recursive: true });
  await writeFile(join(packDir, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\n');
  await writePackYaml(packDir);

  const pack = await loadPack(packDir);
  assert.equal(pack.skillPaths.length, 1);
  assert.ok(pack.skillPaths[0].startsWith(packDir));
});

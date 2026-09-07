import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parse } from 'yaml';
import {
  loadPack,
  loadProfile,
  discoverPacks,
  DEFAULT_PACKS_DIR,
} from '../../src/adapters/packs/loader.js';

const KIND_DIRS = ['fields', 'methods', 'venues'];
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function packDirs() {
  const dirs = [];
  for (const kindDir of KIND_DIRS) {
    let entries;
    try {
      entries = readdirSync(join(DEFAULT_PACKS_DIR, kindDir), { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(DEFAULT_PACKS_DIR, kindDir, entry.name);
      // A venue may ship only a `profile.yaml` (spec §3.4, gate 6); that is a validation
      // profile, not a pack, and `discoverPacks` skips it for the same reason.
      if (existsSync(join(dir, 'pack.yaml'))) dirs.push(dir);
    }
  }
  return dirs;
}

const dirs = packDirs();

test('at least the seven starter packs are shipped under packs/', () => {
  assert.ok(dirs.length >= 7, `found ${dirs.length}`);
});

for (const dir of dirs) {
  test(`${dir.slice(DEFAULT_PACKS_DIR.length + 1)} loads and validates against the pack schema`, async () => {
    const pack = await loadPack(dir);
    assert.equal(typeof pack.name, 'string');
    assert.equal(pack.skills.length, pack.skillPaths.length);
    assert.ok(pack.skillPaths.length > 0);
  });
}

test('every pack skill file exists and its front matter name equals the skill directory', async () => {
  for (const dir of dirs) {
    const pack = await loadPack(dir);
    for (const skillPath of pack.skillPaths) {
      const text = readFileSync(skillPath, 'utf8');
      const m = FRONT_MATTER_RE.exec(text);
      assert.ok(m, `${skillPath} has front matter`);
      const meta = parse(m[1]);
      assert.equal(meta.name, basename(dirname(skillPath)));
      assert.equal(typeof meta.description, 'string');
      assert.ok(meta.description.length > 0, `${skillPath} description is non-empty`);
      assert.equal(meta.phdude.version, 1);
      assert.deepEqual(meta.phdude.writes, []);
    }
  }
});

test('pack names are unique across every kind', async () => {
  const names = await Promise.all(dirs.map(async (dir) => (await loadPack(dir)).name));
  assert.equal(new Set(names).size, names.length, JSON.stringify(names));
});

test('every shipped pack has 8-15 detection keywords', async () => {
  for (const dir of dirs) {
    const pack = await loadPack(dir);
    const n = pack.detect.keywords.length;
    assert.ok(n >= 8 && n <= 15, `${pack.name} has ${n} keywords`);
  }
});

test('every shipped pack has at least 3 terminology entries, 1-3 reviewers, 2-4 recommended checks', async () => {
  for (const dir of dirs) {
    const pack = await loadPack(dir);
    assert.ok(pack.terminology.length >= 3, `${pack.name} terminology`);
    assert.ok(pack.reviewers.length >= 1 && pack.reviewers.length <= 3, `${pack.name} reviewers`);
    assert.ok(
      pack.recommended_checks.length >= 2 && pack.recommended_checks.length <= 4,
      `${pack.name} recommended_checks`,
    );
  }
});

test('discoverPacks loads the built-in root, sorted by name, without throwing', async () => {
  const packs = await discoverPacks([DEFAULT_PACKS_DIR]);
  assert.ok(packs.length >= 7);
  const names = packs.map((p) => p.name);
  assert.deepEqual(names, [...names].sort());
});

test('medicine pack recommends CONSORT, STROBE, and PRISMA', async () => {
  const pack = await loadPack(join(DEFAULT_PACKS_DIR, 'fields', 'medicine'));
  for (const check of ['CONSORT', 'STROBE', 'PRISMA']) {
    assert.ok(pack.recommended_checks.includes(check), check);
  }
});

test('a later root overrides a built-in pack with the same name', async (t) => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'phdude-packs-'));
  const overrideDir = join(workspaceRoot, 'fields', 'quantitative-override');
  await mkdir(join(overrideDir, 'skills', 'quantitative-override'), { recursive: true });
  await writeFile(
    join(overrideDir, 'pack.yaml'),
    [
      'schema: phdude.pack',
      'version: 1',
      'name: humanities',
      'kind: field',
      'description: overridden',
      'terminology: [a, b, c]',
      'detect:',
      '  keywords: [aaa, bbb, ccc, ddd, eee, fff, ggg, hhh]',
      'reviewers: [x]',
      'recommended_checks: [x, y]',
      'skills: [skills/quantitative-override/SKILL.md]',
      'schemas: []',
    ].join('\n'),
  );
  await writeFile(
    join(overrideDir, 'skills', 'quantitative-override', 'SKILL.md'),
    [
      '---',
      'name: quantitative-override',
      'description: test override skill',
      'phdude:',
      '  version: 1',
      '  reads: []',
      '  writes: []',
      '  permissions:',
      '    network: none',
      '    workspace: [read]',
      '---',
      '# override',
    ].join('\n'),
  );
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const packs = await discoverPacks([DEFAULT_PACKS_DIR, workspaceRoot]);
  const humanities = packs.find((p) => p.name === 'humanities');
  assert.equal(humanities.description, 'overridden');
});

test('the generic-thesis venue profile loads, lists the six standard sections in order', async () => {
  const profile = await loadProfile('generic-thesis');
  assert.equal(profile.name, 'generic-thesis');
  assert.deepEqual(
    profile.sections.map((s) => s.id),
    ['abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusions'],
  );
  for (const section of profile.sections) {
    assert.ok(section.max_words > 0, `${section.id} has a word limit`);
  }
});

test('a venue with no profile loads as null, and a bad name is refused', async () => {
  assert.equal(await loadProfile('nature-neuroscience'), null);
  await assert.rejects(() => loadProfile('../etc/passwd'), /invalid venue profile name/);
});

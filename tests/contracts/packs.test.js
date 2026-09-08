import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { parse } from 'yaml';
import {
  loadPack,
  loadProfile,
  discoverPacks,
  discoverProfiles,
  DEFAULT_PACKS_DIR,
} from '../../src/adapters/packs/loader.js';
import { validateProfile } from '../../src/schemas/index.js';
import { sectionLimit } from '../../src/domain/profiles.js';

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
      // A venue may ship only a `profile.yaml` (spec §3.2); that is a validation profile, not a
      // pack, and `discoverPacks` skips it for the same reason.
      if (existsSync(join(dir, 'pack.yaml'))) dirs.push(dir);
    }
  }
  return dirs;
}

const dirs = packDirs();
// A venue pack carries validation data, not guidance: no skills to bundle and nothing to detect
// from the corpus, because a venue is a decision the researcher makes. The bounds below that
// only make sense for guidance are checked over the field and method packs alone.
const venueDirs = dirs.filter((dir) => dir.includes(`${sep}venues${sep}`));
const guidanceDirs = dirs.filter((dir) => !venueDirs.includes(dir));

test('at least the seven starter packs are shipped under packs/', () => {
  assert.ok(guidanceDirs.length >= 7, `found ${guidanceDirs.length}`);
});

for (const dir of dirs) {
  test(`${dir.slice(DEFAULT_PACKS_DIR.length + 1)} loads and validates against the pack schema`, async () => {
    const pack = await loadPack(dir);
    assert.equal(typeof pack.name, 'string');
    assert.equal(pack.skills.length, pack.skillPaths.length);
    if (pack.kind !== 'venue') assert.ok(pack.skillPaths.length > 0);
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

test('every shipped field or method pack has 8-15 detection keywords', async () => {
  for (const dir of guidanceDirs) {
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
  assert.ok(packs.length >= 10);
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

test('the three shipped venues are exactly generic-thesis, ieee and acm', async () => {
  assert.deepEqual(
    (await discoverProfiles([DEFAULT_PACKS_DIR])).map((profile) => profile.name),
    ['acm', 'generic-thesis', 'ieee'],
  );
  assert.deepEqual(venueDirs.map((dir) => basename(dir)).sort(), ['acm', 'generic-thesis', 'ieee']);
});

for (const dir of venueDirs) {
  const name = basename(dir);

  test(`the ${name} venue pack ships a profile that validates against schemas/profile.json`, async () => {
    const profile = await loadProfile(name);
    assert.equal(profile.name, name);
    assert.equal(
      validateProfile(profile).ok,
      false,
      'the resolved paths are not part of the schema',
    );
    assert.deepEqual(validateProfile(parse(readFileSync(join(dir, 'profile.yaml'), 'utf8'))), {
      ok: true,
    });
  });

  test(`the ${name} venue expects the six standard sections, in order, each with a limit`, async () => {
    const profile = await loadProfile(name);
    assert.deepEqual(
      profile.sections.map((section) => section.id),
      ['abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusions'],
    );
    assert.deepEqual(
      profile.sections.map((section) => section.order),
      [1, 2, 3, 4, 5, 6],
    );
    for (const section of profile.sections) {
      assert.equal(section.required, true, `${section.id} is required`);
      const limit = sectionLimit(profile, section);
      assert.ok(limit > 0, `${section.id} has a word limit`);
    }
  });

  test(`the ${name} venue pack vendors its CSL style with the CC BY-SA notice intact`, async () => {
    const profile = await loadProfile(name);
    assert.ok(profile.cslPath, 'the profile points at a CSL file in the pack');
    const csl = readFileSync(profile.cslPath, 'utf8');
    assert.match(csl, /<rights license="http:\/\/creativecommons\.org\/licenses\/by-sa\/3\.0\/">/);
    assert.match(csl, /^<\?xml/);
  });

  test(`the ${name} venue pack ships the LaTeX template its document class needs`, async () => {
    const profile = await loadProfile(name);
    const template = readFileSync(profile.templatePaths.latex, 'utf8');
    assert.match(template, /\$body\$/, 'a pandoc template renders the body');
    assert.match(
      template,
      new RegExp(`\\\\documentclass(\\[[^\\]]*\\])?\\{${profile.document_class}\\}`),
    );
  });

  test(`the ${name} venue pack declares no detection keywords`, async () => {
    const pack = await loadPack(dir);
    assert.equal(pack.kind, 'venue');
    assert.deepEqual(pack.detect.keywords, []);
    assert.deepEqual(pack.skills, []);
  });
}

test('the packs/venues README states the CSL licence the shipped styles carry', () => {
  const readme = readFileSync(join(DEFAULT_PACKS_DIR, 'venues', 'README.md'), 'utf8');
  assert.match(readme, /CC BY-SA 3\.0/);
  assert.match(readme, /citation-style-language\/styles/);
});

test('a venue with no profile loads as null, and a bad name is refused', async () => {
  assert.equal(await loadProfile('nature-neuroscience'), null);
  await assert.rejects(() => loadProfile('../etc/passwd'), /invalid venue profile name/);
});

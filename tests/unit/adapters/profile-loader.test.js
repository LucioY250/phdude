import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import {
  DEFAULT_PACKS_DIR,
  discoverProfiles,
  loadProfile,
} from '../../../src/adapters/packs/loader.js';
import { PhdudeError } from '../../../src/domain/errors.js';

const VALID = {
  schema: 'phdude.profile',
  version: 1,
  name: 'tiny-venue',
  display: 'Tiny Venue',
  document_class: 'article',
  citation_style: 'csl/tiny.csl',
  sections: [{ id: 'abstract', title: 'Abstract', required: true, order: 1 }],
  abstract: { max_words: 100 },
  figures: { formats: ['pdf'] },
  tables: { style: 'booktabs' },
  references: { style: 'Tiny' },
  writing: { first_person: 'never' },
};

async function venueRoot(t, name, profile, { csl = true, files = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-profile-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'venues', name);
  await mkdir(join(dir, 'csl'), { recursive: true });
  if (csl) await writeFile(join(dir, 'csl', 'tiny.csl'), '<style/>\n');
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(join(dir, rel, '..'), { recursive: true });
    await writeFile(join(dir, rel), text);
  }
  if (profile !== null) await writeFile(join(dir, 'profile.yaml'), stringify(profile));
  return root;
}

test('loadProfile validates against schemas/profile.json and reports every failing field', async (t) => {
  const root = await venueRoot(t, 'tiny-venue', { ...VALID, sections: [] });

  await assert.rejects(
    () => loadProfile('tiny-venue', [root]),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /tiny-venue/);
      assert.ok(Array.isArray(err.details) && err.details.length > 0);
      return true;
    },
  );
});

test('loadProfile refuses a profile whose name disagrees with its directory', async (t) => {
  const root = await venueRoot(t, 'tiny-venue', { ...VALID, name: 'other-venue' });

  await assert.rejects(
    () => loadProfile('tiny-venue', [root]),
    (err) => {
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /other-venue/);
      return true;
    },
  );
});

test('loadProfile resolves the CSL and template paths inside the pack', async (t) => {
  const root = await venueRoot(
    t,
    'tiny-venue',
    { ...VALID, templates: { latex: 'templates/tiny.tex' } },
    { files: { 'templates/tiny.tex': '$body$\n' } },
  );

  const profile = await loadProfile('tiny-venue', [root]);
  assert.equal(profile.name, 'tiny-venue');
  assert.equal(profile.dir, join(root, 'venues', 'tiny-venue'));
  assert.equal(profile.cslPath, join(root, 'venues', 'tiny-venue', 'csl', 'tiny.csl'));
  assert.equal(
    profile.templatePaths.latex,
    join(root, 'venues', 'tiny-venue', 'templates', 'tiny.tex'),
  );
});

test('loadProfile refuses a citation style or template that escapes the pack directory', async (t) => {
  const escaping = await venueRoot(t, 'tiny-venue', {
    ...VALID,
    citation_style: '../../../etc/passwd.csl',
  });
  await assert.rejects(() => loadProfile('tiny-venue', [escaping]), /escapes/);

  const absolute = await venueRoot(t, 'tiny-venue', {
    ...VALID,
    templates: { latex: '/etc/passwd' },
  });
  await assert.rejects(() => loadProfile('tiny-venue', [absolute]), /escapes/);
});

test('loadProfile refuses a citation style file the pack does not ship', async (t) => {
  const root = await venueRoot(t, 'tiny-venue', VALID, { csl: false });

  await assert.rejects(
    () => loadProfile('tiny-venue', [root]),
    (err) => {
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /csl\/tiny\.csl/);
      return true;
    },
  );
});

test('a citation style that is a built-in name rather than a file leaves cslPath null', async (t) => {
  const root = await venueRoot(t, 'tiny-venue', { ...VALID, citation_style: 'apa' });

  const profile = await loadProfile('tiny-venue', [root]);
  assert.equal(profile.citation_style, 'apa');
  assert.equal(profile.cslPath, null);
});

test('a venue that ships no profile still loads as null, and a bad name is refused', async () => {
  assert.equal(await loadProfile('nature-neuroscience'), null);
  await assert.rejects(() => loadProfile('../etc/passwd'), /invalid venue profile name/);
});

test('a later root overrides a built-in venue profile of the same name', async (t) => {
  const root = await venueRoot(t, 'ieee', { ...VALID, name: 'ieee', display: 'Local IEEE' });

  const shipped = await loadProfile('ieee');
  assert.equal(shipped.display, 'IEEE conference paper');

  const overridden = await loadProfile('ieee', [DEFAULT_PACKS_DIR, root]);
  assert.equal(overridden.display, 'Local IEEE');
});

test('discoverProfiles lists every venue that ships a profile, sorted, later roots winning', async (t) => {
  const root = await venueRoot(t, 'tiny-venue', VALID);

  const shipped = await discoverProfiles([DEFAULT_PACKS_DIR]);
  assert.deepEqual(
    shipped.map((profile) => profile.name),
    ['acm', 'generic-thesis', 'ieee'],
  );

  const both = await discoverProfiles([DEFAULT_PACKS_DIR, root]);
  assert.deepEqual(
    both.map((profile) => profile.name),
    ['acm', 'generic-thesis', 'ieee', 'tiny-venue'],
  );
});

test('discoverProfiles skips a root that does not exist', async () => {
  assert.deepEqual(await discoverProfiles([join(tmpdir(), 'phdude-not-a-root')]), []);
});

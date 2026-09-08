import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentParserContract } from '../../src/ports/document-parser.js';
import { documentRendererContract } from '../../src/ports/document-renderer.js';
import { searchProviderContract } from '../../src/ports/search-provider.js';
import { DEFAULT_PACKS_DIR, discoverPacks, loadPack } from '../../src/adapters/packs/loader.js';
import { loadSkill } from '../../src/adapters/skills/loader.js';
import { fakeFetch } from '../support/fake-fetch.js';
import { exampleProvider } from '../../examples/extensions/search-provider-example/index.js';
import { exampleParser } from '../../examples/extensions/document-parser-example/index.js';
import { exampleRenderer } from '../../examples/extensions/renderer-example/index.js';

// The four example extensions under examples/extensions/ are third-party code: no dependency on
// PhDude, no import from src/. Running them through the shipped contract suites is what proves
// the ports are interfaces an outsider can implement rather than descriptions of the adapters
// that happen to live in this repository.
const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSIONS = join(HERE, '..', '..', 'examples', 'extensions');
const RENDER_FIXTURES = join(HERE, '..', 'fixtures', 'render');
const PACK_ROOT = join(EXTENSIONS, 'pack-example', 'packs');
const PACK_DIR = join(PACK_ROOT, 'fields', 'example-field');

const PACKAGES = ['search-provider-example', 'document-parser-example', 'renderer-example'];

// Each example ships the recorded responses its own contract run replays, the way a real
// extension would: the fixtures are part of the extension, not of PhDude's test tree.
const providerFx = (name) =>
  readFileSync(join(EXTENSIONS, 'search-provider-example', 'fixtures', name), 'utf8');

const HOST = 'api.example.org';
const success = providerFx('search.json');

searchProviderContract(test, assert, ({ fetch }) => exampleProvider({ fetch, version: '1.0.0' }), {
  fakeFetch,
  success: {
    routes: [{ match: HOST, body: success }],
    expectMinResults: 3,
    expectFromInUrl: 'from_year=2021',
  },
  empty: { routes: [{ match: HOST, body: providerFx('empty.json') }] },
  rateLimited: {
    routes: [
      { match: HOST, status: 429, headers: { 'retry-after': '0' }, body: '', times: 1 },
      { match: HOST, body: success },
    ],
  },
  serverError: { routes: [{ match: HOST, status: 500, body: 'upstream is unwell' }] },
  malformed: { routes: [{ match: HOST, body: providerFx('malformed.txt') }] },
});

documentParserContract(test, assert, exampleParser, [
  ['notes.txt', readFile(join(EXTENSIONS, 'document-parser-example', 'fixtures', 'notes.txt'))],
]);

documentRendererContract(test, assert, exampleRenderer, { fixturesDir: RENDER_FIXTURES });

test('example provider: a work it cannot title is dropped rather than half-mapped', async () => {
  const provider = exampleProvider({ fetch: fakeFetch([{ match: HOST, body: success }]) });
  const results = await provider.search('open science', { limit: 20 });
  const raw = JSON.parse(success).items;
  assert.equal(results.length, raw.length - 1);
  assert.ok(
    raw.some((item) => !item.title),
    'the recorded response carries one untitled work, or this proves nothing',
  );
});

test('example provider: a DOI arrives as a lowercase bare 10.x string', async () => {
  const provider = exampleProvider({ fetch: fakeFetch([{ match: HOST, body: success }]) });
  const results = await provider.search('open science', { limit: 20 });
  const dois = results.map((candidate) => candidate.doi).filter(Boolean);
  assert.ok(dois.length >= 2, `expected several DOIs, got ${dois.length}`);
  for (const doi of dois) assert.match(doi, /^10\.\d{4,9}\/[^\s]+$/);
  assert.ok(
    JSON.parse(success).items.some((item) => /^https?:/i.test(item.doi ?? '')),
    'the recorded response carries one resolver-prefixed DOI, or this proves nothing',
  );
});

test('example parser: the first non-empty line is the title, the rest is the section body', async () => {
  const bytes = await readFile(
    join(EXTENSIONS, 'document-parser-example', 'fixtures', 'notes.txt'),
  );
  const result = await exampleParser.parse(bytes, { path: 'notes.txt' });
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].title, 'Field notes: reading group, 12 March');
  assert.match(result.sections[0].text, /preregistration/);
  assert.doesNotMatch(result.sections[0].text, /12 March/);
});

test('example renderer: an input it cannot honour is a warning naming the file', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'phdude-example-render-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const { warnings } = await exampleRenderer.render({
    input: {
      markdownPath: join(RENDER_FIXTURES, 'sample.md'),
      cslPath: join(RENDER_FIXTURES, 'sample.md'),
    },
    output: { path: join(dir, 'out.txt'), format: 'txt' },
    cwd: dir,
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /CSL style/);
  assert.match(warnings[0], /sample\.md/);
});

test('pack-example: loads through the pack loader with its skill resolved', async () => {
  const pack = await loadPack(PACK_DIR);
  assert.equal(pack.name, 'example-field');
  assert.equal(pack.kind, 'field');
  assert.equal(pack.skillPaths.length, 1);
  assert.ok(pack.detect.keywords.length >= 8 && pack.detect.keywords.length <= 15);
  assert.ok(pack.terminology.length >= 3);
  assert.ok(pack.reviewers.length >= 1 && pack.reviewers.length <= 3);
  assert.ok(pack.recommended_checks.length >= 2 && pack.recommended_checks.length <= 4);
});

test('pack-example: discovery finds it as a second root beside the built-in packs', async () => {
  const packs = await discoverPacks([DEFAULT_PACKS_DIR, PACK_ROOT]);
  const found = packs.find((pack) => pack.name === 'example-field');
  assert.ok(found, `example-field not discovered: ${packs.map((p) => p.name).join(', ')}`);
  assert.equal(found.dir, PACK_DIR);
  const builtIn = await discoverPacks([DEFAULT_PACKS_DIR]);
  assert.equal(
    builtIn.some((pack) => pack.name === 'example-field'),
    false,
    'the example must not be discoverable from the shipped packs root',
  );
});

test('pack-example: its skill loads and declares a v1 contract that writes nothing', async () => {
  const pack = await loadPack(PACK_DIR);
  const skill = await loadSkill(dirname(pack.skillPaths[0]));
  assert.equal(skill.name, 'example-field');
  assert.ok(skill.description.length > 0);
  assert.equal(skill.contract.version, 1);
  assert.deepEqual(skill.contract.writes, []);
  assert.equal(skill.contract.permissions.network, 'none');
  assert.deepEqual(skill.warnings, [], 'the example declares a phdude: contract of its own');
});

for (const name of [...PACKAGES, 'pack-example']) {
  test(`${name}: is a standalone MIT ESM package with no dependencies`, () => {
    const manifest = JSON.parse(readFileSync(join(EXTENSIONS, name, 'package.json'), 'utf8'));
    assert.equal(manifest.type, 'module');
    assert.equal(manifest.license, 'MIT');
    assert.equal(manifest.private, true, 'an example is never published from this repository');
    assert.equal(manifest.dependencies, undefined);
    assert.equal(manifest.devDependencies, undefined);
  });
}

for (const name of PACKAGES) {
  test(`${name}: imports nothing from PhDude`, () => {
    const source = readFileSync(join(EXTENSIONS, name, 'index.js'), 'utf8');
    assert.doesNotMatch(source, /from '(\.\.\/)+src\//);
    assert.doesNotMatch(source, /from 'phdude/);
    assert.match(source, /SPDX-License-Identifier: MIT/);
  });
}

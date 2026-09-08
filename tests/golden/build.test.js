import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { DEFAULT_PACKS_DIR, loadProfile } from '../../src/adapters/packs/loader.js';
import { buildRenderers } from '../../src/adapters/render/index.js';
import { build } from '../../src/application/build.js';

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(here, '..', '..', 'examples', 'generic-thesis');
const EXPECTED = join(here, 'expected');

// The renderer version is part of the build cache and of nothing else the golden reads, so it is
// pinned here rather than taken from package.json: bumping the version must not rewrite a golden.
const VERSION = '0.6.0';

async function example(t) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-build-golden-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(WORKSPACE, root, { recursive: true });
  return {
    store: new FsStore(root),
    clock: () => '2026-09-08T00:00:00.000Z',
    actor: { researcher: 'golden', agent: 'node' },
    renderers: buildRenderers({ execFile, env: process.env, version: VERSION }),
    loadProfile: (name) => loadProfile(name, [DEFAULT_PACKS_DIR]),
  };
}

async function golden(file, text) {
  const path = join(EXPECTED, file);
  if (process.env.UPDATE_GOLDEN) {
    await writeFile(path, text);
    return;
  }
  assert.equal(text, await readFile(path, 'utf8'), `${file} drifted`);
}

// `outputs/` is derived and is not committed with the example, so the build runs in a throwaway
// copy of it - the same rule `cite.test.js` follows for `references.bib`.
test('build golden: examples/generic-thesis builds exactly the committed Markdown', async (t) => {
  const deps = await example(t);
  const result = await build(deps, {});

  assert.equal(result.built, true);
  assert.equal(result.output.path, 'outputs/generic-thesis-example/manuscript.md');
  assert.deepEqual(result.sections, ['introduction']);
  assert.deepEqual(result.warnings, []);

  await golden('build-manuscript.md', await deps.store.readText(result.output.path));
});

test('build golden: the date is the last approval the example recorded, and never today', async () => {
  if (process.env.UPDATE_GOLDEN) return;
  const text = await readFile(join(EXPECTED, 'build-manuscript.md'), 'utf8');
  assert.match(text, /^date: 2026-09-01$/m);
  assert.match(text, /^title: Generic Thesis Example$/m);
  assert.match(text, /^# Introduction$/m);
  // The built-in renderer resolves the citation against the bibliography the build regenerated.
  assert.match(text, /\(Alpha and Beta, 2025\)/);
  assert.match(text, /^## References$/m);
  // A section's evidence markers are approved prose and are rendered as written; they are HTML
  // comments, so they are invisible in every format a reader opens.
  assert.match(text, /<!-- claim: CLAIM-ab73621987 -->/);
});

// Pandoc's own LaTeX output moves between Pandoc versions, and CI's Pandoc is not this machine's,
// so the bytes pinned here are PhDude's: the Markdown the build assembles and hands over. What
// Pandoc then makes of it is asserted structurally, on a machine that has Pandoc.
test('build golden: the IEEE LaTeX build assembles exactly the committed source', async (t) => {
  const deps = await example(t);
  const pandoc = deps.renderers.find((renderer) => renderer.name === 'pandoc');
  if (!(await pandoc.available()).ok) {
    t.skip('pandoc is not installed');
    return;
  }

  const result = await build(deps, { format: 'latex', profile: 'ieee' });
  assert.equal(result.output.path, 'outputs/generic-thesis-example/manuscript.tex');

  await golden(
    'build-ieee-source.md',
    await deps.store.readText('.phdude/cache/build/generic-thesis-example/latex.md'),
  );

  if (process.env.UPDATE_GOLDEN) return;
  const tex = await deps.store.readText(result.output.path);
  assert.match(tex, /\\documentclass\[conference\]\{IEEEtran\}/);
  assert.match(tex, /\\title\{Generic Thesis Example\}/);
  assert.match(tex, /\\section\{Introduction\}/);
  assert.match(tex, /Alpha/, 'the bibliography reached the document through citeproc');

  // Reproducible for the formats ADR 10 promises it for.
  await build(deps, { format: 'latex', profile: 'ieee', force: true });
  assert.equal(await deps.store.readText(result.output.path), tex);
});

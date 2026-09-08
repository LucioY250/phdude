import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { DEFAULT_PACKS_DIR, loadProfile } from '../../src/adapters/packs/loader.js';
import { buildRenderers } from '../../src/adapters/render/index.js';
import { svgConverter } from '../../src/adapters/render/svg.js';
import { discoverSkills, loadSkill } from '../../src/adapters/skills/loader.js';
import { build } from '../../src/application/build.js';
import { initWorkspace } from '../../src/application/init.js';
import * as manuscript from '../../src/application/manuscript.js';
import { renderSectionFile, sectionHash } from '../../src/domain/manuscript.js';
import { PhdudeError } from '../../src/domain/errors.js';

const actor = { researcher: 'test', agent: 'node' };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>\n';

function makeDeps(root) {
  let tick = 0;
  return {
    store: new FsStore(root),
    git: { isInsideRepo: async () => false, initRepo: async () => {}, userName: async () => 'me' },
    agentHosts: [],
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
    actor,
    discoverSkills,
    loadSkill,
    renderers: buildRenderers({ execFile, env: process.env, version: '0.6.0' }),
    svgConvert: svgConverter({ execFile, env: process.env }),
    loadProfile: (name) => loadProfile(name, [DEFAULT_PACKS_DIR]),
  };
}

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);
  await initWorkspace(deps, { title: 'Edge scheduling', agents: [], noGit: true });
  await manuscript.init(deps, { title: 'Edge Scheduling', language: 'en' });
  return deps;
}

// The shortcut the profile suite uses: prose on disk and a status in `manuscript.yaml`, without
// walking a draft through the gates and an approving Decision on every test.
async function section(deps, id, body, status = 'approved') {
  const current = await deps.store.readManuscript();
  const entry = current.sections.find((s) => s.id === id);
  const hash = sectionHash(body);
  await deps.store.writeSection(
    entry.file,
    renderSectionFile({ section: id, status, hash, updated: deps.clock() }, body),
  );
  await deps.store.writeManuscript({
    ...current,
    sections: current.sections.map((s) => (s.id === id ? { ...s, status, hash } : s)),
  });
  if (status === 'approved') {
    await deps.store.appendEvent({
      ts: deps.clock(),
      op: 'manuscript',
      actor,
      ids: [],
      summary: `approved ${id} (DEC-0123456789)`,
    });
  }
}

function source() {
  return {
    schema: 'phdude.source',
    version: 1,
    id: 'SRC-0123456789',
    created: '2026-01-01T00:00:00.000Z',
    actor,
    title: 'Scheduling at the edge',
    authors: ['Alpha, A.'],
    year: 2025,
    type: 'article',
    artifacts: [],
    state: 'canonical',
  };
}

async function buildEvents(store) {
  return (await store.readEvents()).filter((event) => event.op === 'build');
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function rejectsWith(promise, code, match) {
  return assert.rejects(promise, (err) => {
    assert.ok(err instanceof PhdudeError, `expected PhdudeError, got ${err}`);
    assert.equal(err.code, code, err.message);
    if (match) assert.match(`${err.message} ${err.hint ?? ''}`, match);
    return true;
  });
}

test('a Markdown build writes the document, the bibliography and one event', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'abstract', 'Scheduling at the edge, in one paragraph.');
  await section(deps, 'introduction', 'The problem is scheduling under load.');

  const result = await build(deps, {});

  assert.equal(result.built, true);
  assert.equal(result.format, 'md');
  assert.equal(result.profile, 'generic-thesis');
  assert.equal(result.slug, 'edge-scheduling');
  assert.equal(result.output.path, 'outputs/edge-scheduling/manuscript.md');
  assert.deepEqual(result.sections, ['abstract', 'introduction']);
  assert.deepEqual(result.warnings, []);

  const text = await deps.store.readText(result.output.path);
  assert.match(text, /^---\n/);
  assert.match(text, /title: Edge Scheduling/);
  assert.match(text, /abstract: Scheduling at the edge, in one paragraph\./);
  assert.match(text, /^# Introduction$/m);
  // The abstract is metadata, not a chapter: every venue template puts it above the first heading.
  assert.doesNotMatch(text, /^# Abstract$/m);

  assert.ok(await exists(join(deps.store.root, result.bib)), 'references.bib is written');
  assert.equal((await buildEvents(deps.store)).length, 1);
});

test('a section edited outside PhDude since its submit is built with a drift warning', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'The problem is scheduling under load.');
  const entry = (await deps.store.readManuscript()).sections.find((s) => s.id === 'introduction');
  const file = join(deps.store.root, entry.file);
  await writeFile(file, (await readFile(file, 'utf8')) + '\nOne more sentence nobody approved.\n');

  const result = await build(deps, {});

  assert.equal(result.built, true);
  assert.deepEqual(result.warnings, [
    'section introduction was edited outside PhDude since its last submit',
  ]);
  assert.match(await deps.store.readText(result.output.path), /nobody approved/);
});

test('the build event names the file and carries the output hash', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');
  const result = await build(deps, {});

  const [event] = await buildEvents(deps.store);
  assert.equal(event.op, 'build');
  assert.deepEqual(event.ids, []);
  assert.match(event.summary, /outputs\/edge-scheduling\/manuscript\.md/);
  assert.ok(event.summary.includes(result.output.hash), 'the event carries the output hash');
});

test('a second build with nothing moved renders nothing and records nothing', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');

  const first = await build(deps, {});
  const before = await deps.store.readBytes(first.output.path);

  const second = await build(deps, {});
  assert.equal(second.built, false);
  assert.equal(second.reason, 'up to date');
  assert.deepEqual(second.changed, []);
  assert.equal((await buildEvents(deps.store)).length, 1);
  assert.deepEqual(await deps.store.readBytes(first.output.path), before);
});

test('--force builds a document nothing has changed about, and records the second build', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');
  await build(deps, {});

  const forced = await build(deps, { force: true });
  assert.equal(forced.built, true);
  assert.equal((await buildEvents(deps.store)).length, 2);
});

test('an edited section is what changed, and the build says so', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');
  await build(deps, {});

  await section(deps, 'introduction', 'One paragraph, rewritten.');
  const rebuilt = await build(deps, {});
  assert.equal(rebuilt.built, true);
  assert.deepEqual(rebuilt.changed, ['manuscript/introduction.md']);
  assert.match(await deps.store.readText(rebuilt.output.path), /rewritten/);
});

test('a deleted output is rebuilt even though nothing about the inputs moved', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');
  const first = await build(deps, {});
  await rm(join(deps.store.root, first.output.path));

  const rebuilt = await build(deps, {});
  assert.equal(rebuilt.built, true);
  assert.deepEqual(rebuilt.changed, ['output']);
});

test('changing the venue rebuilds, under the venue section titles', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'methods', 'We sampled three campuses.');
  await build(deps, {});

  const ieee = await build(deps, { profile: 'ieee' });
  assert.equal(ieee.built, true);
  assert.equal(ieee.profile, 'ieee');
  // IEEE calls it "Method"; the generic thesis calls it "Methods".
  assert.match(await deps.store.readText(ieee.output.path), /^# Method$/m);
});

test('an unknown venue and an unknown format are refused before anything is written', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');

  await rejectsWith(build(deps, { profile: 'nature' }), 'USAGE', /unknown venue: nature/);
  await rejectsWith(build(deps, { format: 'epub' }), 'VALIDATION', /unknown build format/);
  assert.equal(await exists(join(deps.store.root, 'outputs', 'edge-scheduling')), false);
});

test('a manuscript with nothing approved points at approve, or at --include-drafts', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'A draft.', 'draft');

  await rejectsWith(build(deps, {}), 'VALIDATION', /no approved sections.*--include-drafts/s);

  const drafted = await build(deps, { includeDrafts: true });
  assert.equal(drafted.built, true);
  assert.match(await deps.store.readText(drafted.output.path), /^draft: true$/m);
});

test('--sections narrows the build and rebuilds when the narrowing changes', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'The introduction.');
  await section(deps, 'conclusions', 'The conclusions.');

  const narrowed = await build(deps, { sections: ['conclusions'] });
  assert.deepEqual(narrowed.sections, ['conclusions']);
  const text = await deps.store.readText(narrowed.output.path);
  assert.doesNotMatch(text, /The introduction/);

  const whole = await build(deps, {});
  assert.equal(whole.built, true);
  assert.ok(whole.changed.includes('sections'), 'the narrowing itself is an input');
});

test('the date is the last approval, not the clock, and two builds agree on it', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');

  const first = await build(deps, {});
  const text = await deps.store.readText(first.output.path);
  assert.match(text, /^date: 2026-01-01$/m);

  const rebuilt = await build(deps, { force: true });
  assert.deepEqual(
    await deps.store.readBytes(rebuilt.output.path),
    Buffer.from(text),
    'the same inputs make the same bytes',
  );
});

test("manuscript.yaml's own date wins over the approval record", async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');
  const current = await deps.store.readManuscript();
  await deps.store.writeManuscript({ ...current, date: '2025-11-30T09:00:00.000Z' });

  const result = await build(deps, {});
  assert.match(await deps.store.readText(result.output.path), /^date: 2025-11-30$/m);
});

test('the byline comes from the author profiles under authors/', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');
  await deps.store.writeYamlAtomic('authors/researcher-a.yaml', {
    schema: 'phdude.author-profile',
    version: 1,
    id: 'researcher-a',
    name: 'Researcher A',
    language: 'en',
    tone: { academic: true, assertiveness: 'moderate', first_person: 'sparing' },
    sentences: { length: 'varied', openings: 'varied' },
    paragraphs: { density: 'medium' },
    transitions: 'minimal',
  });

  const result = await build(deps, {});
  assert.match(await deps.store.readText(result.output.path), /^ {2}- Researcher A$/m);
});

test('a figure the prose shows is copied beside the document and the link rewritten', async (t) => {
  const deps = await workspace(t);
  await deps.store.writeTextAtomic('figures/out/adoption.png', 'not really a png');
  await section(
    deps,
    'results',
    'Adoption rose.\n\n![Adoption by channel](figures/out/adoption.png)',
  );

  const result = await build(deps, {});
  assert.deepEqual(result.figures, ['figures/adoption.png']);
  assert.equal(
    await deps.store.readText('outputs/edge-scheduling/figures/adoption.png'),
    'not really a png',
  );

  const text = await deps.store.readText(result.output.path);
  assert.match(text, /!\[Adoption by channel\]\(figures\/adoption\.png\)/);
  assert.doesNotMatch(text, /figures\/out/);
});

test('a rebuilt figure is what changed, even though the prose did not move', async (t) => {
  const deps = await workspace(t);
  await deps.store.writeTextAtomic('figures/out/adoption.png', 'first');
  await section(deps, 'results', '![Adoption](figures/out/adoption.png)');
  await build(deps, {});

  await deps.store.writeTextAtomic('figures/out/adoption.png', 'second');
  const rebuilt = await build(deps, {});
  assert.deepEqual(rebuilt.changed, ['figures/out/adoption.png']);
});

test('an SVG a venue does not take is copied with a warning when rsvg-convert is missing', async (t) => {
  const deps = await workspace(t);
  await deps.store.writeTextAtomic('figures/out/adoption.svg', SVG);
  await section(deps, 'results', '![Adoption](figures/out/adoption.svg)');

  const missing = { ...deps, svgConvert: null };
  const result = await build(missing, {});

  assert.deepEqual(result.figures, ['figures/adoption.svg']);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /figures\/out\/adoption\.svg was copied as SVG/);
  assert.match(result.warnings[0], /generic-thesis takes pdf, png/);
  assert.equal(await deps.store.readText('outputs/edge-scheduling/figures/adoption.svg'), SVG);
});

test('an SVG is converted to PDF when a converter is available', async (t) => {
  const deps = await workspace(t);
  await deps.store.writeTextAtomic('figures/out/adoption.svg', SVG);
  await section(deps, 'results', '![Adoption](figures/out/adoption.svg)');

  const converted = [];
  const fake = {
    name: 'fake-rsvg',
    hint: 'install it',
    available: async () => ({ ok: true, version: '2.0' }),
    convert: async ({ from, to }) => {
      converted.push({ from, to });
      await writeFile(to, '%PDF-1.4\n');
      return { path: to };
    },
  };

  const result = await build({ ...deps, svgConvert: fake }, {});
  assert.deepEqual(result.figures, ['figures/adoption.pdf']);
  assert.deepEqual(result.warnings, []);
  assert.equal(converted.length, 1);
  assert.match(converted[0].to, /outputs\/edge-scheduling\/figures\/adoption\.pdf$/);
  assert.match(await deps.store.readText(result.output.path), /\(figures\/adoption\.pdf\)/);
});

test('a figure the prose points at that is not on disk is a warning, not a broken link', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'results', '![Gone](figures/out/gone.svg)');

  const result = await build(deps, {});
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /figures\/out\/gone\.svg is not on disk/);
  assert.match(
    await deps.store.readText(result.output.path),
    /!\[Gone\]\(figures\/out\/gone\.svg\)/,
  );
});

test('a table linked on a line of its own is inlined; the same link in a sentence is not', async (t) => {
  const deps = await workspace(t);
  await deps.store.writeTextAtomic(
    'tables/out/mean-weight.md',
    '| Group | Mean |\n| --- | ---: |\n| a | 71.40 |\n\nTable: Mean weight by group.\n',
  );
  await section(
    deps,
    'results',
    'The numbers are in [Table 1](tables/out/mean-weight.md), reproduced below.\n\n[Table 1](tables/out/mean-weight.md)\n',
  );

  const result = await build(deps, {});
  const text = await deps.store.readText(result.output.path);
  assert.match(text, /^Table: Mean weight by group\.$/m);
  assert.match(text, /The numbers are in \[Table 1\]\(tables\/out\/mean-weight\.md\), reproduced/);
});

test('the bibliography is regenerated beside the document from the citation registry', async (t) => {
  const deps = await workspace(t);
  await deps.store.writeEntity(source());
  await section(deps, 'introduction', 'Adoption is rising [@alpha2025scheduling].');

  const result = await build(deps, {});
  const bib = await deps.store.readText(result.bib);
  assert.match(bib, /@article\{alpha2025scheduling/);
  // The built-in renderer resolves the key against that bibliography.
  const text = await deps.store.readText(result.output.path);
  assert.match(text, /\(Alpha, 2025\)/);
  assert.match(text, /^## References$/m);
});

test('a new source changes the bibliography, and the bibliography is an input', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');
  const first = await build(deps, {});

  await deps.store.writeEntity(source());

  const rebuilt = await build(deps, {});
  assert.equal(rebuilt.built, true);
  assert.deepEqual(rebuilt.changed, [first.bib]);
});

test('the assembled Markdown is cache, and never the file the build delivers', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');
  const result = await build(deps, {});

  const source = await deps.store.readText('.phdude/cache/build/edge-scheduling/md.md');
  assert.equal(source, '# Introduction\n\nOne paragraph.\n');
  assert.notEqual(source, await deps.store.readText(result.output.path));
  assert.ok(await exists(join(deps.store.root, '.phdude/cache/build/edge-scheduling/md.json')));
});

test('a format whose tool is missing exits 4 naming what to install, and writes nothing', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');

  const absent = {
    ...deps,
    renderers: [
      {
        name: 'pandoc',
        formats: ['docx'],
        available: async () => ({ ok: false, hint: 'install pandoc' }),
        render: async () => assert.fail('render must not be reached'),
      },
    ],
  };

  await rejectsWith(build(absent, { format: 'docx' }), 'TOOL_MISSING', /install pandoc/);
  assert.equal(await exists(join(deps.store.root, 'outputs', 'edge-scheduling')), false);
});

test('a docx build renders through the renderer with the venue CSL and template', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');

  const calls = [];
  const fake = {
    ...deps,
    renderers: [
      {
        name: 'pandoc',
        formats: ['docx'],
        available: async () => ({ ok: true, version: '3.6.4' }),
        render: async ({ input, output, cwd }) => {
          calls.push({ input, output, cwd });
          await writeFile(output.path, 'PK\u0003\u0004fake docx');
          return { path: output.path, warnings: [] };
        },
      },
    ],
  };

  const result = await build(fake, { format: 'docx' });
  assert.equal(result.output.path, 'outputs/edge-scheduling/manuscript.docx');
  assert.equal(calls.length, 1);
  assert.match(calls[0].input.markdownPath, /\.phdude\/cache\/build\/edge-scheduling\/docx\.md$/);
  assert.match(calls[0].input.bibPath, /outputs\/edge-scheduling\/references\.bib$/);
  assert.match(calls[0].input.cslPath, /packs\/venues\/generic-thesis\/csl\/apa\.csl$/);
  assert.equal(calls[0].input.metadata.title, 'Edge Scheduling');
  // Pandoc resolves a relative image path against its working directory, so the build hands it
  // the output directory and the links stay relative to the document.
  assert.match(calls[0].cwd, /outputs\/edge-scheduling$/);
  assert.equal(result.renderer, 'pandoc 3.6.4');
});

test('a renderer upgrade rebuilds a document whose inputs have not moved', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');

  const renderer = (version) => ({
    name: 'pandoc',
    formats: ['html'],
    available: async () => ({ ok: true, version }),
    render: async ({ output }) => {
      await writeFile(output.path, `<p>${version}</p>`);
      return { path: output.path, warnings: [] };
    },
  });

  await build({ ...deps, renderers: [renderer('3.1.3')] }, { format: 'html' });
  const upgraded = await build({ ...deps, renderers: [renderer('3.6.4')] }, { format: 'html' });
  assert.equal(upgraded.built, true);
  assert.ok(upgraded.changed.includes('renderer'), 'the renderer version is part of the record');
});

test('a workspace template registered against the venue outranks the pack template', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');
  await deps.store.writeTextAtomic('templates/custom/house.tex', '$body$\n');
  await deps.store.writeYamlAtomic('.phdude/templates.yaml', {
    schema: 'phdude.templates-registry',
    version: 1,
    templates: [
      {
        name: 'house',
        kind: 'latex',
        path: 'templates/custom/house.tex',
        hash: 'a'.repeat(64),
        for: 'generic-thesis',
      },
    ],
  });

  const calls = [];
  const fake = {
    ...deps,
    renderers: [
      {
        name: 'pandoc',
        formats: ['latex'],
        available: async () => ({ ok: true, version: '3.6.4' }),
        render: async ({ input, output }) => {
          calls.push(input);
          await writeFile(output.path, '\\documentclass{report}\n');
          return { path: output.path, warnings: [] };
        },
      },
    ],
  };

  await build(fake, { format: 'latex' });
  assert.match(calls[0].template, /templates\/custom\/house\.tex$/);
});

test('a renderer warning reaches the caller rather than being swallowed', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');

  const noisy = {
    ...deps,
    renderers: [
      {
        name: 'pandoc',
        formats: ['html'],
        available: async () => ({ ok: true, version: '3.6.4' }),
        render: async ({ output }) => {
          await writeFile(output.path, '<p/>');
          return { path: output.path, warnings: ['the template dropped the abstract'] };
        },
      },
    ],
  };

  const result = await build(noisy, { format: 'html' });
  assert.deepEqual(result.warnings, ['the template dropped the abstract']);
});

// The built-in Markdown renderer has one fixed citation style (ADR 10). Handing it the venue's
// CSL would make every default build warn about a file the build itself chose to pass.
test('the md build is not handed a CSL it cannot apply, so it warns about nothing', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');

  const result = await build(deps, {});
  assert.deepEqual(result.warnings, []);

  const calls = [];
  const fake = {
    ...deps,
    renderers: [
      {
        name: 'pandoc',
        formats: ['html'],
        available: async () => ({ ok: true, version: '3.6.4' }),
        render: async ({ input, output }) => {
          calls.push(input);
          await writeFile(output.path, '<p/>');
          return { path: output.path, warnings: [] };
        },
      },
    ],
  };
  await build(fake, { format: 'html' });
  assert.match(calls[0].cslPath, /apa\.csl$/, 'a format that can use the CSL still gets it');
});

test('a section whose file has gone missing is named, not silently dropped', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');
  await rm(join(deps.store.root, 'manuscript', 'introduction.md'));

  await rejectsWith(build(deps, {}), 'VALIDATION', /introduction is approved but/);
});

test('a workspace with no manuscript, and one that is not a workspace at all', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-build-bare-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const deps = makeDeps(root);

  await rejectsWith(build(deps, {}), 'USAGE', /not a PhDude workspace/);

  await initWorkspace(deps, { title: 'Empty', agents: [], noGit: true });
  await rejectsWith(build(deps, {}), 'USAGE', /no manuscript/);
});

test('the built-in Markdown build is byte-identical across two forced runs', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'abstract', 'The abstract.');
  await section(deps, 'introduction', 'The introduction [@nobody2020].');

  const first = await build(deps, { force: true });
  const bytes = await readFile(join(deps.store.root, first.output.path));
  await build(deps, { force: true });
  assert.deepEqual(await readFile(join(deps.store.root, first.output.path)), bytes);
});

// The real thing, on a machine that has Pandoc. It is skipped honestly where Pandoc is absent
// rather than passing vacuously: a renderer test that never ran the renderer proves nothing.
test('a DOCX build through real Pandoc produces a document and is then up to date', async (t) => {
  const deps = await workspace(t);
  const pandoc = deps.renderers.find((renderer) => renderer.name === 'pandoc');
  if (!(await pandoc.available()).ok) {
    t.skip('pandoc is not installed');
    return;
  }

  await deps.store.writeEntity(source());
  await section(deps, 'abstract', 'One paragraph.');
  await section(deps, 'introduction', 'Adoption is rising [@alpha2025scheduling].');

  const built = await build(deps, { format: 'docx' });
  assert.equal(built.built, true);
  assert.equal(built.output.path, 'outputs/edge-scheduling/manuscript.docx');
  const bytes = await deps.store.readBytes(built.output.path);
  assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK', 'a docx is a zip package');
  assert.ok(bytes.length > 1000, 'the document has content');

  const again = await build(deps, { format: 'docx' });
  assert.equal(again.built, false);
  assert.equal((await buildEvents(deps.store)).length, 1);
});

test('a LaTeX build through real Pandoc uses the venue class and repeats byte for byte', async (t) => {
  const deps = await workspace(t);
  const pandoc = deps.renderers.find((renderer) => renderer.name === 'pandoc');
  if (!(await pandoc.available()).ok) {
    t.skip('pandoc is not installed');
    return;
  }

  await section(deps, 'abstract', 'One paragraph.');
  await section(deps, 'introduction', 'The problem is scheduling under load.');

  const built = await build(deps, { format: 'latex', profile: 'ieee' });
  const tex = await deps.store.readText(built.output.path);
  assert.match(tex, /\\documentclass\[conference\]\{IEEEtran\}/);
  assert.match(tex, /\\begin\{abstract\}/);
  assert.match(tex, /\\section\{Introduction\}/);

  await build(deps, { format: 'latex', profile: 'ieee', force: true });
  assert.equal(await deps.store.readText(built.output.path), tex, 'latex is byte-reproducible');
});

test('a cache record nobody can read means the build has not been made, not an error', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');
  await build(deps, {});

  await deps.store.writeTextAtomic('.phdude/cache/build/edge-scheduling/md.json', '{ not json');
  const rebuilt = await build(deps, {});
  assert.equal(rebuilt.built, true);
  assert.deepEqual(rebuilt.changed, ['*']);
});

// Pandoc runs with the output directory as its working directory, and an external tool neither
// creates that directory nor survives being spawned into one that is not there.
test('the output directory exists before the renderer is handed a path in it', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');

  let cwdExisted = null;
  const checking = {
    ...deps,
    renderers: [
      {
        name: 'pandoc',
        formats: ['html'],
        available: async () => ({ ok: true, version: '3.6.4' }),
        render: async ({ output, cwd }) => {
          cwdExisted = await exists(cwd);
          await writeFile(output.path, '<p/>');
          return { path: output.path, warnings: [] };
        },
      },
    ],
  };

  assert.equal(await exists(join(deps.store.root, 'outputs', 'edge-scheduling')), false);
  await build(checking, { format: 'html' });
  assert.equal(cwdExisted, true, 'the renderer was given a working directory that exists');
});

// `phdude present outline` writes outline.md / outline.pptx into the same directory, so the two
// commands must not be able to overwrite each other.
test('the build owns file names distinct from the ones present outline writes', async (t) => {
  const deps = await workspace(t);
  await section(deps, 'introduction', 'One paragraph.');
  await deps.store.writeTextAtomic('outputs/edge-scheduling/outline.md', '# A slide\n');

  const result = await build(deps, {});
  for (const name of ['manuscript.md', 'references.bib']) {
    assert.equal(result.output.path === `outputs/edge-scheduling/outline.md`, false);
    assert.ok(await exists(join(deps.store.root, 'outputs', 'edge-scheduling', name)));
  }
  assert.equal(
    await deps.store.readText('outputs/edge-scheduling/outline.md'),
    '# A slide\n',
    'a build leaves an outline beside it untouched',
  );
});

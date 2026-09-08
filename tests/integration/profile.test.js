import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { initWorkspace } from '../../src/application/init.js';
import * as manuscript from '../../src/application/manuscript.js';
import * as profile from '../../src/application/profile.js';
import { apply } from '../../src/application/packs.js';
import {
  DEFAULT_PACKS_DIR,
  discoverPacks,
  discoverProfiles,
  loadProfile,
} from '../../src/adapters/packs/loader.js';
import { discoverSkills, loadSkill } from '../../src/adapters/skills/loader.js';
import { renderSectionFile, sectionHash } from '../../src/domain/manuscript.js';
import { PhdudeError } from '../../src/domain/errors.js';

const actor = { researcher: 'test', agent: 'node' };

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
    loadPacks: () => discoverPacks([DEFAULT_PACKS_DIR]),
    loadProfile: (name) => loadProfile(name),
    loadProfiles: () => discoverProfiles([DEFAULT_PACKS_DIR]),
  };
}

async function workspace({ withManuscript = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-profile-'));
  const deps = makeDeps(root);
  await initWorkspace(deps, { title: 'Edge scheduling', agents: [], noGit: true });
  if (withManuscript) await manuscript.init(deps, { title: 'Edge scheduling', language: 'en' });
  return deps;
}

// Writes a section file and marks the entry approved, which is what `profile check` measures.
async function writeSection(deps, id, body) {
  const current = await deps.store.readManuscript();
  const entry = current.sections.find((section) => section.id === id);
  const hash = sectionHash(body);
  await deps.store.writeSection(
    entry.file,
    renderSectionFile({ section: id, status: 'draft', hash, updated: deps.clock() }, body),
  );
  await deps.store.writeManuscript({
    ...current,
    sections: current.sections.map((section) =>
      section.id === id ? { ...section, status: 'draft', hash } : section,
    ),
  });
}

function rejectsWith(promise, code, match) {
  return assert.rejects(promise, (err) => {
    assert.ok(err instanceof PhdudeError, `expected PhdudeError, got ${err}`);
    assert.equal(err.code, code, err.message);
    if (match) assert.match(`${err.message} ${err.hint ?? ''}`, match);
    return true;
  });
}

test('list names every shipped venue and marks none applied or active on a fresh workspace', async () => {
  const deps = await workspace();
  const venues = await profile.list(deps);

  assert.deepEqual(
    venues.map((venue) => venue.name),
    ['acm', 'generic-thesis', 'ieee'],
  );
  assert.equal(
    venues.every((venue) => venue.applied === false && venue.active === false),
    true,
  );
  assert.equal(venues.find((venue) => venue.name === 'ieee').document_class, 'IEEEtran');
  assert.equal(venues.find((venue) => venue.name === 'ieee').sections, 6);
});

test('packs apply <venue> records the venue in phdude.yaml and list reflects it', async () => {
  const deps = await workspace();

  const result = await apply(deps, 'ieee');
  assert.equal(result.applied, true);
  assert.deepEqual(result.project.venues, ['ieee']);
  assert.deepEqual((await deps.store.readProject()).venues, ['ieee']);

  const events = (await deps.store.readEvents()).filter((event) => event.op === 'packs');
  assert.equal(events.length, 1);
  assert.equal(events[0].summary, 'applied ieee');

  assert.equal((await profile.list(deps)).find((venue) => venue.name === 'ieee').applied, true);

  const second = await apply(deps, 'ieee');
  assert.deepEqual(second, { applied: false });
  assert.equal((await deps.store.readEvents()).filter((e) => e.op === 'packs').length, 1);
});

test('applying a venue leaves the field and method lists alone', async () => {
  const deps = await workspace();
  await apply(deps, 'acm');
  const project = await deps.store.readProject();
  assert.deepEqual(project.fields, []);
  assert.deepEqual(project.methods, []);
  assert.deepEqual(project.venues, ['acm']);
});

test('profile use sets target_profile on the manuscript and records one event', async () => {
  const deps = await workspace();

  const result = await profile.use(deps, 'ieee');
  assert.deepEqual(result, { profile: 'ieee', changed: true });
  assert.equal((await deps.store.readManuscript()).target_profile, 'ieee');

  const events = (await deps.store.readEvents()).filter((event) => event.op === 'profile');
  assert.equal(events.length, 1);
  assert.equal(events[0].summary, 'target profile ieee');

  const again = await profile.use(deps, 'ieee');
  assert.deepEqual(again, { profile: 'ieee', changed: false });
  assert.equal((await deps.store.readEvents()).filter((e) => e.op === 'profile').length, 1);

  assert.equal((await profile.list(deps)).find((venue) => venue.name === 'ieee').active, true);
});

test('profile use refuses a venue that ships no profile, and writes nothing', async () => {
  const deps = await workspace();

  await rejectsWith(profile.use(deps, 'nature-neuroscience'), 'USAGE', /unknown venue/);
  assert.equal((await deps.store.readManuscript()).target_profile, undefined);
  assert.equal((await deps.store.readEvents()).filter((e) => e.op === 'profile').length, 0);
});

test('show resolves --profile first, then the manuscript target, and refuses neither', async () => {
  const deps = await workspace();

  await rejectsWith(profile.show(deps), 'USAGE', /no venue profile to report on/);

  const flagged = await profile.show(deps, { profile: 'acm' });
  assert.equal(flagged.name, 'acm');
  assert.equal(flagged.document_class, 'acmart');
  assert.equal(flagged.active, false);
  assert.ok(flagged.cslPath.endsWith(join('acm', 'csl', 'acm-sig-proceedings.csl')));

  await profile.use(deps, 'generic-thesis');
  const target = await profile.show(deps);
  assert.equal(target.name, 'generic-thesis');
  assert.equal(target.active, true);
});

test('check on a manuscript with nothing written yet informs about each section and blocks on none', async () => {
  const deps = await workspace();
  await profile.use(deps, 'ieee');

  const report = await profile.check(deps);
  assert.equal(report.profile, 'ieee');
  assert.equal(report.blocked, false);
  assert.equal(report.counts.block, 0);
  assert.deepEqual(
    report.findings.filter((f) => f.code === 'section-unwritten').map((f) => f.section),
    ['abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusions'],
  );
  assert.equal(
    report.findings.some((f) => f.code === 'references-style' && f.message.includes('IEEE')),
    true,
  );
});

test('check blocks on an abstract over the venue limit and reports the count', async () => {
  const deps = await workspace();
  await profile.use(deps, 'ieee');
  await writeSection(deps, 'abstract', `${'word '.repeat(300)}\n`);

  const report = await profile.check(deps);
  assert.equal(report.blocked, true);
  assert.equal(report.counts.block, 1);
  const finding = report.findings.find((f) => f.code === 'section-words');
  assert.equal(finding.section, 'abstract');
  assert.match(finding.message, /300 words exceeds the 250-word limit/);
});

test('the same abstract passes under generic-thesis, which sets a larger limit', async () => {
  const deps = await workspace();
  await profile.use(deps, 'generic-thesis');
  await writeSection(deps, 'abstract', `${'word '.repeat(300)}\n`);

  assert.equal((await profile.check(deps)).blocked, false);
  assert.equal((await profile.check(deps, { profile: 'ieee' })).blocked, true);
});

test('check counts the section body without its markers or citations', async () => {
  const deps = await workspace();
  await profile.use(deps, 'ieee');
  const body = `${'word '.repeat(240)}${'[@smith2020] '.repeat(20)}\n`;
  await writeSection(deps, 'abstract', body);

  const report = await profile.check(deps);
  assert.equal(
    report.findings.some((f) => f.code === 'section-words'),
    false,
    'twenty citations are not twenty words',
  );
});

test('check warns about a figure in a format the venue does not take', async () => {
  const deps = await workspace();
  await profile.use(deps, 'ieee');
  await deps.store.writeEntity({
    schema: 'phdude.figure',
    version: 1,
    id: 'FIG-1111111111',
    created: '2026-01-01T00:00:00.000Z',
    actor,
    tags: [],
    name: 'load-curve',
    caption: 'Load over time.',
    alt: 'A line rising then flattening.',
    generator: { runtime: 'node', script: 'figures/load.mjs', args: [] },
    inputs: [],
    outputs: [{ path: 'figures/out/load-curve.svg', format: 'svg' }],
    runs: [],
    state: 'candidate',
  });

  const finding = (await profile.check(deps)).findings.find((f) => f.code === 'figure-format');
  assert.equal(finding.severity, 'warn');
  assert.match(finding.message, /load-curve produces svg/);
});

test('check outside a workspace, and without a manuscript, says which is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-profile-none-'));
  await rejectsWith(profile.check(makeDeps(root)), 'USAGE', /not a PhDude workspace/);

  const deps = await workspace({ withManuscript: false });
  await rejectsWith(
    profile.check(deps, { profile: 'ieee' }),
    'USAGE',
    /this workspace has no manuscript/,
  );
});

test('a venue applied to the project is still not the manuscript target until profile use', async () => {
  const deps = await workspace();
  await apply(deps, 'acm');

  const listed = (await profile.list(deps)).find((venue) => venue.name === 'acm');
  assert.equal(listed.applied, true);
  assert.equal(listed.active, false);
  await rejectsWith(profile.check(deps), 'USAGE', /no venue profile to report on/);
});

test('the venue profile the writing gates load is the one profile check reports on', async () => {
  const deps = await workspace();
  await profile.use(deps, 'ieee');
  const ctx = await manuscript.gateContext(deps, {
    manuscript: await deps.store.readManuscript(),
    entry: { id: 'abstract', order: 1 },
  });
  assert.equal(ctx.venueProfile.name, 'ieee');
  assert.equal(ctx.venueProfile.abstract.max_words, 250);
});

test('init writes a workspace at version 4 with an empty venue list and template registry', async () => {
  const deps = await workspace();
  const project = await deps.store.readProject();
  assert.equal(project.workspace_version, 4);
  assert.deepEqual(project.venues, []);
  assert.deepEqual(await deps.store.readYaml(join('.phdude', 'templates.yaml')), {
    schema: 'phdude.templates',
    version: 1,
    templates: [],
  });
  assert.match(
    await readFile(join(deps.store.root, '.phdude', 'templates.yaml'), 'utf8'),
    /templates: \[\]/,
  );
});

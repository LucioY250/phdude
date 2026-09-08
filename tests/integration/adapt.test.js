import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { DEFAULT_PACKS_DIR, discoverPacks, loadProfile } from '../../src/adapters/packs/loader.js';
import { discoverSkills, loadSkill } from '../../src/adapters/skills/loader.js';
import { adapt, adaptedPath } from '../../src/application/adapt.js';
import { initWorkspace } from '../../src/application/init.js';
import * as manuscript from '../../src/application/manuscript.js';
import * as profile from '../../src/application/profile.js';
import { PhdudeError } from '../../src/domain/errors.js';
import { renderSectionFile, sectionHash } from '../../src/domain/manuscript.js';

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
  };
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'phdude-adapt-'));
  const deps = makeDeps(root);
  await initWorkspace(deps, { title: 'Edge scheduling', agents: [], noGit: true });
  await manuscript.init(deps, { title: 'Edge scheduling', language: 'en' });
  return deps;
}

// Writes prose for a section and puts the entry in `status`, which is what the plan measures.
async function writeSection(deps, id, body, status = 'approved') {
  const current = await deps.store.readManuscript();
  const entry = current.sections.find((section) => section.id === id);
  const hash = sectionHash(body);
  await deps.store.writeSection(
    entry.file,
    renderSectionFile({ section: id, status, hash, updated: deps.clock() }, body),
  );
  await deps.store.writeManuscript({
    ...current,
    sections: current.sections.map((section) =>
      section.id === id ? { ...section, status, hash } : section,
    ),
  });
}

function longAbstract(count) {
  return Array.from({ length: count }, (_, i) => `word${i}`).join(' ');
}

function rejectsWith(promise, code, match) {
  return assert.rejects(promise, (err) => {
    assert.ok(err instanceof PhdudeError, `expected PhdudeError, got ${err}`);
    assert.equal(err.code, code, err.message);
    if (match) assert.match(`${err.message} ${err.hint ?? ''}`, match);
    return true;
  });
}

test('a plan maps the standard sections onto the target venue', async () => {
  const deps = await workspace();
  const result = await adapt(deps, { to: 'ieee' });

  assert.equal(result.from, 'generic-thesis');
  assert.equal(result.to, 'ieee');
  assert.equal(result.applied, false);
  assert.deepEqual(
    result.plan.mapping.map((row) => [row.from, row.to]),
    [
      ['abstract', 'abstract'],
      ['introduction', 'introduction'],
      ['methods', 'methods'],
      ['results', 'results'],
      ['discussion', 'discussion'],
      ['conclusions', 'conclusions'],
    ],
  );
});

test('a plan names the citation style the target uses', async () => {
  const deps = await workspace();
  const { plan } = await adapt(deps, { to: 'acm' });
  assert.deepEqual(plan.citation_style, { from: 'APA 7th edition', to: 'ACM SIG Proceedings' });
});

test('a plan reports the abstract against the target limit', async () => {
  const deps = await workspace();
  await writeSection(deps, 'abstract', longAbstract(320));

  const { plan } = await adapt(deps, { to: 'ieee' });
  assert.deepEqual(plan.abstract, {
    section: 'abstract',
    words: 320,
    from: 500,
    to: 250,
    delta: 70,
  });
});

test('a plan reports the terminology the target venue renames', async () => {
  const deps = await workspace();
  await writeSection(deps, 'results', 'Figure 2 shows the split, and Figure 3 confirms it.');

  const { plan } = await adapt(deps, { to: 'ieee' });
  assert.deepEqual(plan.terminology, [{ from: 'Figure', to: 'Fig.', hits: 2 }]);
});

test('a plan reports a figure in a format the target does not take', async () => {
  const deps = await workspace();
  await deps.store.writeEntity({
    schema: 'phdude.figure',
    version: 1,
    id: 'FIG-1111111111',
    created: deps.clock(),
    actor,
    state: 'candidate',
    name: 'adoption',
    caption: 'Adoption by channel',
    alt: 'A bar chart of adoption by recruitment channel.',
    generator: { runtime: 'node', script: 'figures/adoption.mjs', args: [] },
    inputs: [],
    outputs: [{ path: 'figures/out/adoption.svg', format: 'svg' }],
    runs: [],
  });

  const { plan } = await adapt(deps, { to: 'ieee' });
  assert.deepEqual(plan.figures, [{ id: 'FIG-1111111111', from: 'svg', to: 'pdf' }]);
});

test('a plan writes nothing and records no event', async () => {
  const deps = await workspace();
  const before = (await deps.store.readEvents()).length;

  await adapt(deps, { to: 'ieee' });

  assert.equal((await deps.store.readEvents()).length, before);
  assert.equal(await deps.store.readYaml(adaptedPath('ieee')), null);
});

test('--apply writes manuscript/manuscript.<venue>.yaml and records one adapt event', async () => {
  const deps = await workspace();
  await writeSection(deps, 'introduction', 'The question is whether adoption differs by channel.');

  const before = (await deps.store.readEvents()).length;
  const result = await adapt(deps, { to: 'ieee', apply: true });

  assert.equal(result.applied, true);
  assert.equal(result.path, 'manuscript/manuscript.ieee.yaml');

  const events = await deps.store.readEvents();
  assert.equal(events.length, before + 1);
  assert.equal(events.at(-1).op, 'adapt');
  assert.match(events.at(-1).summary, /manuscript\.ieee\.yaml/);

  const adapted = await deps.store.readYaml('manuscript/manuscript.ieee.yaml');
  assert.equal(adapted.target_profile, 'ieee');
  assert.equal(adapted.schema, 'phdude.manuscript');
  assert.deepEqual(
    adapted.sections.map((section) => section.title),
    ['Abstract', 'Introduction', 'Method', 'Results', 'Discussion', 'Conclusion'],
  );
});

test('--apply leaves the canonical manuscript and every section file untouched', async () => {
  const deps = await workspace();
  const body = 'The question is whether adoption differs by channel.';
  await writeSection(deps, 'introduction', body);

  const before = await deps.store.readManuscript();
  const prose = await deps.store.readSection('manuscript/introduction.md');

  await adapt(deps, { to: 'ieee', apply: true });

  assert.deepEqual(await deps.store.readManuscript(), before);
  assert.equal(await deps.store.readSection('manuscript/introduction.md'), prose);
});

test('--apply marks a section over the target limit revised and drops its approval', async () => {
  const deps = await workspace();
  await writeSection(deps, 'abstract', longAbstract(320));

  const current = await deps.store.readManuscript();
  await deps.store.writeManuscript({
    ...current,
    sections: current.sections.map((section) =>
      section.id === 'abstract'
        ? { ...section, status: 'approved', approved_by: 'DEC-0123456789' }
        : section,
    ),
  });

  const result = await adapt(deps, { to: 'ieee', apply: true });
  assert.deepEqual(result.revised, ['abstract']);

  const adapted = await deps.store.readYaml('manuscript/manuscript.ieee.yaml');
  const abstract = adapted.sections.find((section) => section.id === 'abstract');
  assert.equal(abstract.status, 'revised');
  assert.equal(Object.hasOwn(abstract, 'approved_by'), false);
});

test('applying the same adaptation twice writes once and records once', async () => {
  const deps = await workspace();
  await adapt(deps, { to: 'ieee', apply: true });
  const after = (await deps.store.readEvents()).length;

  const again = await adapt(deps, { to: 'ieee', apply: true });

  assert.equal(again.applied, false);
  assert.equal(again.reason, 'up to date');
  assert.equal((await deps.store.readEvents()).length, after);
});

test('a section the target venue does not list is carried over, after the ones it names', async () => {
  const deps = await workspace();
  const current = await deps.store.readManuscript();
  await deps.store.writeManuscript({
    ...current,
    sections: [
      ...current.sections,
      {
        id: 'appendix',
        title: 'Appendix',
        file: 'manuscript/appendix.md',
        order: 7,
        status: 'draft',
        hash: null,
        claims: [],
        questions: [],
      },
    ],
  });

  const result = await adapt(deps, { to: 'ieee', apply: true });
  const row = result.plan.mapping.find((entry) => entry.from === 'appendix');
  assert.equal(row.to, null);
  assert.match(row.reason, /needs decision/);

  const adapted = await deps.store.readYaml('manuscript/manuscript.ieee.yaml');
  assert.equal(adapted.sections.at(-1).id, 'appendix');
  assert.equal(adapted.sections.at(-1).order, 7);
});

test('the venue the manuscript already targets is refused, with or without --apply', async () => {
  const deps = await workspace();
  await profile.use(deps, 'ieee');

  await rejectsWith(adapt(deps, { to: 'ieee' }), 'USAGE', /already targets ieee/);
  await rejectsWith(adapt(deps, { to: 'ieee', apply: true }), 'USAGE', /already targets ieee/);
});

test('a venue this install does not ship is a usage error naming it', async () => {
  const deps = await workspace();
  await rejectsWith(adapt(deps, { to: 'neurips' }), 'USAGE', /unknown venue: neurips/);
});

test('adapt needs a venue to adapt to', async () => {
  const deps = await workspace();
  await rejectsWith(adapt(deps, {}), 'USAGE', /--to/);
});

test('a workspace with no manuscript cannot be adapted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-adapt-'));
  const deps = makeDeps(root);
  await initWorkspace(deps, { title: 'Empty', agents: [], noGit: true });

  await rejectsWith(adapt(deps, { to: 'ieee' }), 'USAGE', /no manuscript/);
});

test('a workspace that needs migration can still be planned, but not applied', async () => {
  const deps = await workspace();
  const project = await deps.store.readProject();
  await deps.store.writeProject({ ...project, workspace_version: 3 });

  const { plan } = await adapt(deps, { to: 'ieee' });
  assert.ok(plan.mapping.length > 0);

  await rejectsWith(adapt(deps, { to: 'ieee', apply: true }), 'USAGE', /needs migration/);
});

test('the manuscript adapt starts from is the venue it targets today', async () => {
  const deps = await workspace();
  await profile.use(deps, 'acm');

  const result = await adapt(deps, { to: 'ieee' });
  assert.equal(result.from, 'acm');
  assert.deepEqual(result.plan.citation_style, {
    from: 'ACM SIG Proceedings',
    to: 'IEEE',
  });
});

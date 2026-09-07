import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { addEntity } from '../../src/application/add.js';
import { propose, approve as approveDecision } from '../../src/application/decide.js';
import * as manuscript from '../../src/application/manuscript.js';
import { parseSectionFile, sectionHash } from '../../src/domain/manuscript.js';
import { PhdudeError } from '../../src/domain/errors.js';

const actor = { researcher: 'test', agent: 'node' };

function makeDeps(root) {
  let tick = 0;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
    actor,
    readText: (path) => readFile(join(root, path), 'utf8').catch(() => null),
  };
}

async function newRoot() {
  return mkdtemp(join(tmpdir(), 'phdude-manuscript-'));
}

async function draft(deps, name, text) {
  await writeFile(join(deps.store.root, name), text);
  return name;
}

async function withSource(deps) {
  const { obj } = await addEntity(deps, 'source', {
    title: 'A Study of Cognitive Load',
    authors: ['Z. Zeta'],
    year: 2020,
    type: 'article',
  });
  return obj;
}

async function initialized(root = null) {
  const deps = makeDeps(root ?? (await newRoot()));
  await manuscript.init(deps, { title: 'A thesis', language: 'en' });
  return deps;
}

function rejectsWith(promise, code, match) {
  return assert.rejects(promise, (err) => {
    assert.ok(err instanceof PhdudeError, `expected PhdudeError, got ${err}`);
    assert.equal(err.code, code, err.message);
    if (match) assert.match(`${err.message} ${err.hint ?? ''}`, match);
    return true;
  });
}

test('init writes manuscript.yaml with planned sections and no section files', async () => {
  const deps = makeDeps(await newRoot());
  const result = await manuscript.init(deps, { title: 'A thesis', language: 'en' });

  assert.equal(result.sections.length, 6);
  const onDisk = await deps.store.readManuscript();
  assert.equal(onDisk.title, 'A thesis');
  assert.deepEqual(onDisk.voice, { kind: 'consensus' });
  assert.ok(onDisk.sections.every((s) => s.status === 'planned' && s.hash === null));

  assert.equal(await deps.store.exists(join('manuscript', 'introduction.md')), false);

  const events = await deps.store.readEvents();
  assert.deepEqual(
    events.map((e) => e.op),
    ['manuscript'],
  );
  assert.deepEqual(events[0].ids, []);
});

test('init records the author voice, and refuses a second manuscript', async () => {
  const deps = makeDeps(await newRoot());
  await manuscript.init(deps, { title: 'A thesis', language: 'es', voice: 'researcher-a' });
  const onDisk = await deps.store.readManuscript();
  assert.deepEqual(onDisk.voice, { kind: 'author', author: 'researcher-a' });
  assert.equal(onDisk.language, 'es');

  await rejectsWith(manuscript.init(deps, { title: 'Another' }), 'POLICY', /already/);
  assert.equal((await deps.store.readEvents()).length, 1, 'the refusal records no event');
  assert.equal((await deps.store.readEvents())[0].summary, 'manuscript initialized (6 sections)');
});

test('init rejects a voice that is not an author slug', async () => {
  const deps = makeDeps(await newRoot());
  await rejectsWith(
    manuscript.init(deps, { title: 'A thesis', voice: '../escape' }),
    'VALIDATION',
    /voice/,
  );
  assert.equal(await deps.store.readManuscript(), null);
});

test('list and status report the planned sections before anything is written', async () => {
  const deps = await initialized();
  const sections = await manuscript.list(deps);
  assert.deepEqual(
    sections.map((s) => s.id),
    ['abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusions'],
  );

  const status = await manuscript.status(deps);
  assert.deepEqual(status.counts, { planned: 6, draft: 0, revised: 0, approved: 0 });
  assert.equal(status.title, 'A thesis');
});

test('list without a manuscript points at init', async () => {
  const deps = makeDeps(await newRoot());
  await rejectsWith(manuscript.list(deps), 'USAGE', /manuscript init/);
});

test('submit writes the section, its front matter, the hash, the report and one event', async () => {
  const deps = await initialized();
  const source = await withSource(deps);
  const body = `# Introduction\n\nSMEs adopt AI slowly [@zeta2020study] and [@${source.id}].\n`;
  const file = await draft(deps, 'draft.md', body);

  const result = await manuscript.submit(deps, { section: 'introduction', file });
  assert.deepEqual(result.findings, []);
  assert.equal(result.section.status, 'draft');

  const text = await readFile(join(deps.store.root, 'manuscript', 'introduction.md'), 'utf8');
  const parsed = parseSectionFile(text);
  assert.equal(parsed.front.section, 'introduction');
  assert.equal(parsed.front.status, 'draft');
  assert.equal(parsed.front.hash, sectionHash(body));
  assert.ok(parsed.front.updated);
  assert.equal(parsed.body, body.replace(/\s+$/, '') + '\n');

  const onDisk = await deps.store.readManuscript();
  const entry = onDisk.sections.find((s) => s.id === 'introduction');
  assert.equal(entry.status, 'draft');
  assert.equal(entry.hash, sectionHash(body));

  const report = await deps.store.readYaml(join('manuscript', 'reports', 'introduction.yaml'));
  assert.equal(report.schema, 'phdude.section-report');
  assert.equal(report.section, 'introduction');
  assert.equal(report.hash, sectionHash(body));
  assert.equal(report.blocks, 0);
  assert.deepEqual(report.gates, [{ gate: 'gate-citations', findings: 0, blocked: false }]);

  const events = await deps.store.readEvents();
  assert.equal(events.filter((e) => e.op === 'manuscript').length, 2, 'init, then one submit');
  assert.equal(events.at(-1).summary, 'submitted introduction (draft)');
});

test('submit with an unresolved citation writes nothing and reports the finding', async () => {
  const deps = await initialized();
  await withSource(deps);
  const file = await draft(deps, 'draft.md', '# Introduction\n\nA claim [@nobody2000nothing].\n');

  await assert.rejects(manuscript.submit(deps, { section: 'introduction', file }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /gate-citations/);
    assert.match(err.message, /1 finding/);
    assert.ok(Array.isArray(err.details) && err.details.length === 1);
    assert.match(err.details[0], /nobody2000nothing/);
    return true;
  });

  assert.equal(await deps.store.exists(join('manuscript', 'introduction.md')), false);
  assert.equal(await deps.store.exists(join('manuscript', 'reports', 'introduction.yaml')), false);
  const onDisk = await deps.store.readManuscript();
  assert.equal(onDisk.sections.find((s) => s.id === 'introduction').status, 'planned');
  const events = await deps.store.readEvents();
  assert.equal(events.at(-1).op, 'add', 'a blocked submit records no event');
});

test('submit refuses an unknown section and a missing draft file', async () => {
  const deps = await initialized();
  const file = await draft(deps, 'draft.md', 'Prose.\n');
  await rejectsWith(manuscript.submit(deps, { section: 'nowhere', file }), 'USAGE', /nowhere/);
  await rejectsWith(
    manuscript.submit(deps, { section: 'introduction', file: 'missing.md' }),
    'USAGE',
    /missing\.md/,
  );
  await rejectsWith(manuscript.submit(deps, { section: 'introduction' }), 'USAGE', /--file/);
});

test('submit --revision moves a draft to revised', async () => {
  const deps = await initialized();
  const file = await draft(deps, 'draft.md', '# Introduction\n\nFirst pass.\n');
  await manuscript.submit(deps, { section: 'introduction', file });

  await draft(deps, 'draft.md', '# Introduction\n\nSecond pass.\n');
  const revised = await manuscript.submit(deps, {
    section: 'introduction',
    file,
    revision: true,
  });
  assert.equal(revised.section.status, 'revised');

  const events = await deps.store.readEvents();
  assert.equal(events.at(-1).summary, 'submitted introduction (revised)');
});

test('submit --revision on a planned section is refused: there is nothing to revise', async () => {
  const deps = await initialized();
  const file = await draft(deps, 'draft.md', 'Prose.\n');
  await rejectsWith(
    manuscript.submit(deps, { section: 'introduction', file, revision: true }),
    'POLICY',
    /planned/,
  );
});

async function approvedSection(deps, { section = 'introduction' } = {}) {
  const file = await draft(deps, 'draft.md', `# Introduction\n\nA drafted ${section}.\n`);
  await manuscript.submit(deps, { section, file });
  const { obj: decision } = await propose(deps, {
    title: `Approve the ${section}`,
    rationale: 'Read end to end by the supervisor.',
    affects: [`manuscript:${section}`],
  });
  await approveDecision(deps, decision.id, { by: 'A Supervisor' });
  return { decision, file };
}

test('approve needs an approved decision that names manuscript:<section>', async () => {
  const deps = await initialized();
  const { decision } = await approvedSection(deps);

  const result = await manuscript.approve(deps, { section: 'introduction', decision: decision.id });
  assert.equal(result.section.status, 'approved');
  assert.equal(result.section.approved_by, decision.id);

  const onDisk = await deps.store.readManuscript();
  assert.equal(onDisk.sections.find((s) => s.id === 'introduction').approved_by, decision.id);
  assert.equal(
    (await deps.store.readEvents()).at(-1).summary,
    `approved introduction (${decision.id})`,
  );
});

test('approve refuses without a decision, on an unapproved one, and on the wrong subject', async () => {
  const deps = await initialized();
  const file = await draft(deps, 'draft.md', '# Introduction\n\nDrafted.\n');
  await manuscript.submit(deps, { section: 'introduction', file });

  await rejectsWith(manuscript.approve(deps, { section: 'introduction' }), 'USAGE', /--decision/);

  const { obj: pending } = await propose(deps, {
    title: 'Approve the introduction later',
    rationale: 'Not read yet.',
    affects: ['manuscript:introduction'],
  });
  await rejectsWith(
    manuscript.approve(deps, { section: 'introduction', decision: pending.id }),
    'POLICY',
    /not approved/,
  );

  const { obj: other } = await propose(deps, {
    title: 'Approve the methods',
    rationale: 'A different section entirely.',
    affects: ['manuscript:methods'],
  });
  await approveDecision(deps, other.id, { by: 'A Supervisor' });
  await rejectsWith(
    manuscript.approve(deps, { section: 'introduction', decision: other.id }),
    'POLICY',
    /manuscript:introduction/,
  );

  await rejectsWith(
    manuscript.approve(deps, { section: 'introduction', decision: 'DEC-0000000000' }),
    'POLICY',
    /unknown decision/,
  );

  const onDisk = await deps.store.readManuscript();
  assert.equal(onDisk.sections.find((s) => s.id === 'introduction').status, 'draft');
});

test('approve refuses a planned section: there is no draft behind it', async () => {
  const deps = await initialized();
  const { obj: decision } = await propose(deps, {
    title: 'Approve the results',
    rationale: 'Nothing written yet.',
    affects: ['manuscript:results'],
  });
  await approveDecision(deps, decision.id, { by: 'A Supervisor' });
  await rejectsWith(
    manuscript.approve(deps, { section: 'results', decision: decision.id }),
    'POLICY',
    /planned/,
  );
});

test('submit on an approved section is refused until it is reopened', async () => {
  const deps = await initialized();
  const { decision, file } = await approvedSection(deps);
  await manuscript.approve(deps, { section: 'introduction', decision: decision.id });

  await rejectsWith(manuscript.submit(deps, { section: 'introduction', file }), 'POLICY', /reopen/);

  const reopened = await manuscript.reopen(deps, { section: 'introduction' });
  assert.equal(reopened.section.status, 'revised');
  assert.ok(!('approved_by' in reopened.section), 'a reopened section is no longer approved');
  assert.equal((await deps.store.readEvents()).at(-1).summary, 'reopened introduction (revised)');

  const resubmitted = await manuscript.submit(deps, {
    section: 'introduction',
    file,
    revision: true,
  });
  assert.equal(resubmitted.section.status, 'revised');
});

test('reopen refuses a section that is not approved', async () => {
  const deps = await initialized();
  await rejectsWith(manuscript.reopen(deps, { section: 'introduction' }), 'POLICY', /approved/);
});

test('show returns the section entry and its body', async () => {
  const deps = await initialized();
  const body = '# Introduction\n\nDrafted prose.\n';
  const file = await draft(deps, 'draft.md', body);

  const planned = await manuscript.show(deps, 'methods');
  assert.equal(planned.status, 'planned');
  assert.equal(planned.body, null);

  await manuscript.submit(deps, { section: 'introduction', file });
  const shown = await manuscript.show(deps, 'introduction');
  assert.equal(shown.status, 'draft');
  assert.equal(shown.body, body);
  assert.equal(shown.hash, sectionHash(body));
});

test('a citation of a source whose candidate was dismissed blocks the submit', async () => {
  const deps = await initialized();
  const source = await withSource(deps);
  const candidate = {
    schema: 'phdude.candidate',
    version: 1,
    id: 'CAND-9876543210',
    created: '2026-01-01T00:00:00.000Z',
    actor,
    provider: 'arxiv',
    providers: ['arxiv'],
    external_id: 'arxiv:2001.00001',
    title: 'A Study of Cognitive Load',
    authors: ['Z. Zeta'],
    year: 2020,
    venue: null,
    doi: null,
    url: null,
    abstract: null,
    type: 'article',
    open_access: null,
    cited_by: null,
    query: 'cognitive load',
    question: null,
    search: 'SEARCH-0123456789',
    score: 0.5,
    score_parts: {},
    needs_approval: false,
    state: 'dismissed',
    reason: 'superseded by a peer-reviewed version',
  };
  await deps.store.writeEntity(candidate);
  await deps.store.writeEntity({
    ...source,
    ext: { research: { candidate: candidate.id } },
  });

  const file = await draft(deps, 'draft.md', '# Introduction\n\nContested [@zeta2020study].\n');
  await assert.rejects(manuscript.submit(deps, { section: 'introduction', file }), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.details[0], new RegExp(candidate.id));
    return true;
  });
});

test('a decision may only name a manuscript section the manuscript actually has', async () => {
  const deps = await initialized();
  await rejectsWith(
    propose(deps, {
      title: 'Approve a section that does not exist',
      rationale: 'Typo in the section name.',
      affects: ['manuscript:intro'],
    }),
    'VALIDATION',
    /unknown manuscript section intro/,
  );

  const bare = makeDeps(await newRoot());
  await rejectsWith(
    propose(bare, {
      title: 'Approve the introduction',
      rationale: 'There is no manuscript yet.',
      affects: ['manuscript:introduction'],
    }),
    'VALIDATION',
    /unknown manuscript section/,
  );
});

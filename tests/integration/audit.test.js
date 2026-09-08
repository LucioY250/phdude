import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lookupDoi } from '../../src/adapters/search/crossref-doi.js';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { addEntity } from '../../src/application/add.js';
import * as audit from '../../src/application/audit.js';
import * as manuscript from '../../src/application/manuscript.js';
import * as review from '../../src/application/review.js';
import { newCandidate } from '../../src/domain/entities.js';
import { CURRENT_WORKSPACE_VERSION } from '../../src/domain/versioning.js';
import { fakeFetch } from '../support/fake-fetch.js';

const actor = { researcher: 'test', agent: 'node' };

const fixture = (name) =>
  readFileSync(new URL(`../fixtures/search/crossref/${name}`, import.meta.url), 'utf8');

function makeDeps(root) {
  let tick = 0;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
    actor,
  };
}

async function writePolicy(root, { network }) {
  await mkdir(join(root, '.phdude'), { recursive: true });
  await writeFile(
    join(root, '.phdude', 'research-policy.yaml'),
    [
      'schema: phdude.research-policy',
      'version: 1',
      'network:',
      `  enabled: ${network}`,
      'providers: [crossref]',
    ].join('\n') + '\n',
  );
}

async function draft(deps, sectionId, body) {
  const doc = await deps.store.readManuscript();
  const entry = doc.sections.find((section) => section.id === sectionId);
  await deps.store.writeSection(entry.file, body);
  entry.status = 'draft';
  await deps.store.writeManuscript(doc);
}

// One source with a DOI, the evidence and claim it backs, and a manuscript whose introduction
// is drafted: enough for every offline rule to have something to say or stay quiet about.
async function workspace({ network = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-audit-'));
  const deps = makeDeps(root);
  await deps.store.writeProject({
    schema: 'phdude.project',
    version: 1,
    workspace_version: CURRENT_WORKSPACE_VERSION,
    title: 'Adoption',
    fields: [],
    methods: [],
    outputs: [],
    mode: 'full',
    agents: [],
  });
  await writePolicy(root, { network });

  const { obj: source } = await addEntity(deps, 'source', {
    title: 'Adoption of AI in Small Firms',
    authors: ['Z. Zeta'],
    year: 2020,
    type: 'article',
    identifiers: { doi: '10.1234/adoption' },
  });
  const { obj: question } = await addEntity(deps, 'question', {
    text: 'How fast do small firms adopt AI?',
    objectives: ['Measure the lag'],
  });
  const { obj: evidence } = await addEntity(deps, 'evidence', {
    source: source.id,
    locator: 'p. 3',
    excerpt: 'Adoption is slower among firms below fifty employees.',
    strength: 'moderate',
  });
  const { obj: claim } = await addEntity(deps, 'claim', {
    statement: 'Small firms adopt AI more slowly than large ones.',
    kind: 'empirical',
    supported_by: [evidence.id],
    questions: [question.id],
    sections: ['Introduction'],
  });
  await manuscript.init(deps, { title: 'Adoption', language: 'en' });

  return { deps, root, source, question, evidence, claim };
}

async function addCandidate(deps, fields) {
  const candidate = newCandidate({
    provider: 'crossref',
    external_id: fields.doi ?? fields.title,
    query: 'ai adoption',
    search: 'SEARCH-1111111111',
    actor,
    created: '2026-01-01T00:00:00Z',
    ...fields,
  });
  await deps.store.writeEntity(candidate);
  return candidate;
}

async function auditEvents(deps) {
  return (await deps.store.readEvents()).filter((event) => event.op === 'audit');
}

function ruleFor(reviews, match) {
  return reviews.filter((item) => match.test(item.message));
}

function rejectsWith(promise, code, match) {
  return assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    if (match) assert.match(err.message, match);
    return true;
  });
}

test('audit citations: records the offline findings as citation reviews and one event', async () => {
  const { deps, source, claim } = await workspace();
  await draft(deps, 'introduction', `Firms are slow [@ghost2019]. <!-- claim: ${claim.id} -->`);

  const result = await audit.citations(deps, {});

  assert.equal(result.network, false);
  assert.equal(result.checked, 0);
  assert.ok(result.created.length >= 1);
  for (const item of result.created) {
    assert.equal(item.kind, 'citation');
    assert.equal(item.status, 'open');
    assert.equal(item.mode, 'full');
    assert.deepEqual(item.by, actor);
  }

  const unresolved = ruleFor(result.created, /\[@ghost2019\]/);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].severity, 'block');
  assert.equal(unresolved[0].target, 'manuscript:introduction');

  // The claim's evidence cites SRC-…, so the claim is not the auditor's problem.
  assert.equal(ruleFor(result.created, new RegExp(`${claim.id} is asserted`)).length, 0);

  const files = await readdir(join(deps.store.root, 'reviews'));
  const written = files.filter((name) => name.startsWith('REVIEW-'));
  assert.equal(written.length, result.created.length);
  assert.ok(
    written.some((name) => name.startsWith(unresolved[0].id)),
    'the finding is a file on disk',
  );

  const events = await auditEvents(deps);
  assert.equal(events.length, 1);
  assert.deepEqual([...events[0].ids].sort(), result.created.map((item) => item.id).sort());
  assert.match(events[0].summary, /offline/);
  assert.ok(!source.id.startsWith('REVIEW-'));
});

test('audit citations: an uncited source is a note, never a block', async () => {
  const { deps } = await workspace();
  const { obj: unused } = await addEntity(deps, 'source', {
    title: 'A paper nothing rests on',
    authors: ['A. Alpha'],
    year: 2018,
    type: 'article',
  });

  const result = await audit.citations(deps, {});
  const note = result.created.find((item) => item.target === unused.id);

  assert.ok(note, 'the uncited source is reported');
  assert.equal(note.severity, 'note');
  assert.match(note.message, /not cited by any evidence/);
});

test('audit citations: a claim asserted with no source behind it is major', async () => {
  const { deps } = await workspace();
  const { obj: orphan } = await addEntity(deps, 'claim', {
    statement: 'Adoption is accelerating everywhere.',
    kind: 'empirical',
  });
  await draft(deps, 'discussion', `It is accelerating. <!-- claim: ${orphan.id} -->`);

  const result = await audit.citations(deps, {});
  const finding = result.created.find((item) => item.message.includes(`${orphan.id} is asserted`));

  assert.ok(finding, 'the unsourced claim is reported');
  assert.equal(finding.severity, 'major');
  assert.equal(finding.target, 'manuscript:discussion');
  assert.deepEqual(finding.evidence, [orphan.id]);
});

test('audit citations: citing a source whose candidate was dismissed is major', async () => {
  const { deps, source } = await workspace();
  const candidate = await addCandidate(deps, {
    title: source.title,
    year: 2020,
    doi: '10.1234/adoption',
    state: 'dismissed',
  });
  await deps.store.writeEntity({ ...candidate, state: 'dismissed', reason: 'predatory venue' });
  await draft(deps, 'introduction', `Slow adoption [@${source.id}].`);

  const result = await audit.citations(deps, {});
  const finding = result.created.find((item) => item.message.includes('was dismissed'));

  assert.ok(finding, 'the dismissed candidate is reported');
  assert.equal(finding.severity, 'major');
  assert.equal(finding.target, source.id);
  assert.deepEqual(finding.evidence, [candidate.id]);
});

test('audit citations: re-running with the same findings creates nothing and records no event', async () => {
  const { deps } = await workspace();
  await draft(deps, 'introduction', 'Firms are slow [@ghost2019].');

  const first = await audit.citations(deps, {});
  const second = await audit.citations(deps, {});

  assert.ok(first.created.length > 0);
  assert.deepEqual(second.created, []);
  assert.equal(second.existing.length, first.created.length);
  assert.equal((await auditEvents(deps)).length, 1);
});

test('audit citations: a re-run never reopens a finding the researcher dismissed', async () => {
  const { deps } = await workspace();
  await draft(deps, 'introduction', 'Firms are slow [@ghost2019].');

  const first = await audit.citations(deps, {});
  const target = first.created.find((item) => item.message.includes('[@ghost2019]'));
  await review.dismiss(deps, target.id, { reason: 'the key is fixed in the next draft' });

  const second = await audit.citations(deps, {});
  const carried = second.existing.find((item) => item.id === target.id);

  assert.equal(carried.status, 'dismissed');
  assert.equal(carried.reason, 'the key is fixed in the next draft');
});

test('audit citations: a workspace with nothing wrong records nothing and no event', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-audit-empty-'));
  const deps = makeDeps(root);
  await deps.store.writeProject({
    schema: 'phdude.project',
    version: 1,
    workspace_version: CURRENT_WORKSPACE_VERSION,
    title: 'Empty',
    fields: [],
    methods: [],
    outputs: [],
    mode: 'full',
    agents: [],
  });

  const result = await audit.citations(deps, {});

  assert.deepEqual(result.created, []);
  assert.deepEqual(result.existing, []);
  assert.equal((await auditEvents(deps)).length, 0);
});

test('audit citations: a workspace that needs migrating is refused before anything is written', async () => {
  const { deps } = await workspace();
  const project = await deps.store.readProject();
  await deps.store.writeProject({ ...project, workspace_version: 1 });

  await rejectsWith(audit.citations(deps, {}), 'USAGE', /needs migration/);
  assert.equal((await auditEvents(deps)).length, 0);
});

// --- the online half -------------------------------------------------------------------

function doiDeps(deps, routes) {
  const fetch = fakeFetch(routes);
  return {
    ...deps,
    fetch,
    lookupDoi: (doi) => lookupDoi(fetch, doi, { version: '0.7.0' }),
  };
}

test('audit citations: the DOI lookup never runs while the policy is closed', async () => {
  const { deps } = await workspace({ network: false });
  const online = doiDeps(deps, [{ match: 'api.crossref.org', body: fixture('doi-match.json') }]);

  const result = await audit.citations(online, {});

  assert.equal(result.network, false);
  assert.equal(result.checked, 0);
  assert.equal(online.fetch.calls.length, 0, 'nothing left the machine');
});

test('audit citations: --allow-network opens the lookup the policy keeps shut', async () => {
  const { deps } = await workspace({ network: false });
  const online = doiDeps(deps, [{ match: 'api.crossref.org', body: fixture('doi-match.json') }]);

  const result = await audit.citations(online, { allowNetwork: true });

  assert.equal(result.network, true);
  assert.equal(result.checked, 1);
  assert.equal(online.fetch.calls.length, 1);
  assert.equal(
    result.created.filter((item) => /Crossref/.test(item.message)).length,
    0,
    'a matching record says nothing',
  );
});

test('audit citations: a title Crossref disagrees with is a major mismatch', async () => {
  const { deps, source } = await workspace({ network: true });
  const online = doiDeps(deps, [{ match: 'api.crossref.org', body: fixture('doi-mismatch.json') }]);

  const result = await audit.citations(online, {});
  const finding = result.created.find((item) => item.message.includes('Groundwater'));

  assert.ok(finding, 'the mismatch is reported');
  assert.equal(finding.severity, 'major');
  assert.equal(finding.target, source.id);
  assert.match(finding.message, /similarity 0\.\d\d/);
});

test('audit citations: a retraction blocks', async () => {
  const { deps, source } = await workspace({ network: true });
  const online = doiDeps(deps, [
    { match: 'api.crossref.org', body: fixture('doi-retracted.json') },
  ]);

  const result = await audit.citations(online, {});
  const finding = result.created.find((item) => item.message.includes('retraction'));

  assert.ok(finding, 'the retraction is reported');
  assert.equal(finding.severity, 'block');
  assert.equal(finding.target, source.id);
});

test('audit citations: a DOI Crossref does not resolve is major', async () => {
  const { deps, source } = await workspace({ network: true });
  const online = doiDeps(deps, [{ match: 'api.crossref.org', status: 404, body: 'not found' }]);

  const result = await audit.citations(online, {});
  const finding = result.created.find((item) => item.message.includes('does not resolve'));

  assert.ok(finding, 'the unresolved DOI is reported');
  assert.equal(finding.severity, 'major');
  assert.equal(finding.target, source.id);
});

test('audit citations: a provider that did not answer is a warning, not a finding', async () => {
  const { deps } = await workspace({ network: true });
  const online = doiDeps(deps, [{ match: 'api.crossref.org', status: 500, body: 'boom' }]);

  const result = await audit.citations(online, {});

  assert.equal(result.checked, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /crossref-doi/);
  assert.equal(result.created.filter((item) => /Crossref/.test(item.message)).length, 0);
});

test('audit citations: a source with no DOI is never looked up', async () => {
  const { deps } = await workspace({ network: true });
  await addEntity(deps, 'source', {
    title: 'A book with no DOI',
    authors: ['A. Alpha'],
    year: 1999,
    type: 'book',
  });
  const online = doiDeps(deps, [{ match: 'api.crossref.org', body: fixture('doi-match.json') }]);

  const result = await audit.citations(online, {});

  assert.equal(result.checked, 1);
  assert.equal(online.fetch.calls.length, 1);
});

test('audit citations: the event says how many DOIs were verified', async () => {
  const { deps } = await workspace({ network: true });
  const online = doiDeps(deps, [{ match: 'api.crossref.org', body: fixture('doi-mismatch.json') }]);

  await audit.citations(online, {});
  const [event] = await auditEvents(deps);

  assert.match(event.summary, /1 DOI\(s\) verified/);
});

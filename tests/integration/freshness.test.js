import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { addEntity } from '../../src/application/add.js';
import { freshness } from '../../src/application/freshness.js';
import { status } from '../../src/application/status.js';
import { renderFreshness, renderStatus } from '../../src/adapters/cli/output.js';
import { newCandidate, newSearch } from '../../src/domain/entities.js';

const actor = { researcher: 'test', agent: 'node' };
const NOW = () => '2026-09-07T12:00:00Z';

function makeDeps(root) {
  let tick = 0;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 8, 7, 0, 0, tick++)).toISOString(),
    actor,
  };
}

async function newRoot() {
  return mkdtemp(join(tmpdir(), 'phdude-freshness-'));
}

async function recordSearch(store, { query, question, lastRun }) {
  const search = newSearch({
    query,
    question,
    providers: ['openalex'],
    filters: { from: 2021, limit: 20 },
    runs: [{ at: lastRun, provider: 'openalex', count: 1, new: 1 }],
    last_run: lastRun,
    actor,
    created: lastRun,
  });
  await store.writeEntity(search);
  return search;
}

async function recordCandidate(store, search, { title, state = 'candidate' }) {
  const candidate = newCandidate({
    provider: 'openalex',
    external_id: title,
    title,
    year: 2024,
    query: search.query,
    question: search.question,
    search: search.id,
    actor,
    created: search.last_run,
  });
  await store.writeEntity({ ...candidate, state });
  return candidate;
}

test('freshness: reports the last search per question, source ages and the summary', async () => {
  const deps = makeDeps(await newRoot());
  await addEntity(deps, 'question', { text: 'Does it replicate?' });
  await addEntity(deps, 'question', { text: 'Does it generalise?' });
  await addEntity(deps, 'source', { title: 'An Older Study', authors: ['A'], year: 2020 });
  await addEntity(deps, 'source', { title: 'A Newer Study', authors: ['B'], year: 2026 });
  await recordSearch(deps.store, {
    query: 'replication',
    question: 'RQ-1',
    lastRun: '2026-01-01T12:00:00Z',
  });

  const report = await freshness({ store: deps.store, clock: NOW });

  assert.equal(report.now, '2026-09-07T12:00:00Z');
  assert.equal(report.staleAfterDays, 180, 'no policy file reads as the default threshold');
  assert.deepEqual(report.questions, [
    {
      question: 'RQ-1',
      lastSearch: '2026-01-01T12:00:00Z',
      daysAgo: 249,
      stale: true,
      searches: 1,
    },
    { question: 'RQ-2', lastSearch: null, daysAgo: null, stale: true, searches: 0 },
  ]);
  assert.deepEqual(report.sources.map((s) => s.age).sort(), [0, 6]);
  assert.equal(report.summary.stale, 2);
  assert.equal(report.summary.neverSearched, 1);
  assert.equal(report.summary.searches, 1);
  assert.equal(report.summary.oldest, 6);

  const text = renderFreshness(report);
  assert.match(text, /RQ-1\s+last searched 2026-01-01 \(249 day\(s\) ago\)\s+\[stale\]/);
  assert.match(text, /RQ-2\s+never searched\s+\[stale\]/);
  assert.match(text, /a search is stale after 180 day\(s\)/);
});

test('freshness: a question searched today is not stale', async () => {
  const deps = makeDeps(await newRoot());
  await addEntity(deps, 'question', { text: 'Does it replicate?' });
  await recordSearch(deps.store, {
    query: 'replication',
    question: 'RQ-1',
    lastRun: '2026-09-07T00:00:00Z',
  });

  const report = await freshness({ store: deps.store, clock: NOW });
  assert.equal(report.questions[0].stale, false);
  assert.equal(report.summary.stale, 0);
});

test('freshness: the policy threshold overrides the default', async () => {
  const deps = makeDeps(await newRoot());
  await deps.store.writeYamlAtomic(join('.phdude', 'research-policy.yaml'), {
    schema: 'phdude.research-policy',
    version: 1,
    research: { freshness: { stale_after_days: 30 } },
  });
  await addEntity(deps, 'question', { text: 'Does it replicate?' });
  await recordSearch(deps.store, {
    query: 'replication',
    question: 'RQ-1',
    lastRun: '2026-08-01T12:00:00Z',
  });

  const report = await freshness({ store: deps.store, clock: NOW });
  assert.equal(report.staleAfterDays, 30);
  assert.equal(report.questions[0].stale, true, '37 days is stale once the policy says 30');
});

test('status: the Literature block counts candidates by state, searches and stale questions', async () => {
  const deps = makeDeps(await newRoot());
  await addEntity(deps, 'question', { text: 'Does it replicate?' });
  await addEntity(deps, 'question', { text: 'Does it generalise?' });
  const search = await recordSearch(deps.store, {
    query: 'replication',
    question: 'RQ-1',
    lastRun: '2026-09-07T00:00:00Z',
  });
  await recordCandidate(deps.store, search, { title: 'A Replication Study' });
  await recordCandidate(deps.store, search, { title: 'Another Study', state: 'dismissed' });

  const report = await status({ store: deps.store, clock: NOW });

  assert.deepEqual(report.literature, {
    candidates: { total: 2, byState: { candidate: 1, dismissed: 1 } },
    searches: 1,
    questions: 2,
    staleQuestions: 1,
  });

  const text = renderStatus(report);
  assert.match(text, /Literature:\n {2}Candidates: total=2 \(candidate=1, dismissed=1\)/);
  assert.match(text, / {2}Searches: 1\n/);
  assert.match(text, /Questions with a stale or missing search: 1 of 2/);
});

test('status: candidates and searches stay out of the knowledge counts', async () => {
  const deps = makeDeps(await newRoot());
  const search = await recordSearch(deps.store, {
    query: 'replication',
    question: null,
    lastRun: '2026-09-07T00:00:00Z',
  });
  await recordCandidate(deps.store, search, { title: 'A Replication Study' });

  const report = await status({ store: deps.store, clock: NOW });
  assert.ok(!Object.keys(report.knowledge.byType).includes('candidate'));
  assert.ok(!Object.keys(report.knowledge.byType).includes('search'));
  assert.equal(report.literature.candidates.total, 1);
});

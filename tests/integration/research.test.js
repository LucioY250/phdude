import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { buildProviders } from '../../src/adapters/search/index.js';
import { PhdudeError } from '../../src/domain/errors.js';
import { newQuestion } from '../../src/domain/entities.js';
import * as research from '../../src/application/research.js';
import { fakeFetch } from '../support/fake-fetch.js';

const actor = { researcher: 'test', agent: 'node' };

const fixture = (name) =>
  readFileSync(new URL(`../fixtures/search/${name}`, import.meta.url), 'utf8');

const OPENALEX = 'api.openalex.org';
const CROSSREF = 'api.crossref.org';

function successRoutes() {
  return [
    { match: OPENALEX, body: fixture('openalex/search.json') },
    { match: CROSSREF, body: fixture('crossref/search.json') },
  ];
}

function makeDeps(root, routes = successRoutes(), names = ['openalex', 'crossref'], startTick = 0) {
  let tick = startTick;
  const fetch = fakeFetch(routes);
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 8, 7, 10, 0, tick++)).toISOString(),
    actor,
    fetch,
    providers: buildProviders(names, { fetch, env: {}, version: '0.3.0' }),
  };
}

async function newRoot({ network = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-research-'));
  await mkdir(join(root, '.phdude'), { recursive: true });
  if (network !== null) {
    await writeFile(
      join(root, '.phdude', 'research-policy.yaml'),
      [
        'schema: phdude.research-policy',
        'version: 1',
        'network:',
        `  enabled: ${network}`,
        'providers: [openalex, crossref]',
        'research:',
        '  year_range: { from: 2021 }',
        '  preprints: { require_approval: true }',
        '  limit: 20',
      ].join('\n') + '\n',
    );
  }
  return root;
}

async function addQuestion(store, n, text) {
  const question = newQuestion({
    n,
    text,
    actor,
    created: '2026-09-01T00:00:00Z',
  });
  await store.writeEntity(question);
  return question;
}

test('search: merges two providers into one candidate per work and records the search', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await addQuestion(deps.store, 1, 'How do open science practices spread?');

  const result = await research.search(deps, { query: 'open science', question: 'RQ-1' });

  assert.deepEqual(result.warnings, []);
  assert.equal(result.candidates.created.length, 3, 'six provider hits collapse into three works');
  assert.deepEqual(result.candidates.existing, []);

  const candidates = await research.list(deps);
  assert.equal(candidates.length, 3);
  for (const candidate of candidates) {
    assert.deepEqual(candidate.providers, ['openalex', 'crossref'], candidate.title);
    assert.equal(candidate.provider, 'openalex', 'the first provider owns the record');
    assert.equal(candidate.question, 'RQ-1');
    assert.equal(candidate.query, 'open science');
    assert.equal(candidate.search, result.search.id);
    assert.equal(candidate.state, 'candidate');
    assert.ok(candidate.ext.ids.crossref, 'the other provider’s id is kept');
  }

  const scores = candidates.map((c) => c.score);
  assert.deepEqual(
    scores,
    [...scores].sort((a, b) => b - a),
    'list is ordered by score',
  );
  for (const candidate of candidates) {
    assert.deepEqual(Object.keys(candidate.score_parts).sort(), ['citations', 'rank', 'recency']);
  }
});

test('search: records one run per provider and one event per provider call', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);

  const { search: recorded } = await research.search(deps, { query: 'open science' });

  assert.equal(recorded.query, 'open science');
  assert.equal(recorded.question, null);
  assert.deepEqual(recorded.providers, ['openalex', 'crossref']);
  assert.deepEqual(
    recorded.runs.map((r) => [r.provider, r.count, r.new]),
    [
      ['openalex', 3, 3],
      ['crossref', 3, 0],
    ],
    'the second provider added no work the first had not already returned',
  );
  assert.equal(recorded.last_run, recorded.runs[0].at);
  assert.equal(recorded.filters.from, 2021);
  assert.equal(recorded.filters.limit, 20);

  const events = await deps.store.readEvents();
  const searches = events.filter((e) => e.op === 'search');
  assert.equal(searches.length, 2, 'one event per provider call');
  assert.deepEqual(
    searches.map((e) => e.summary),
    ['openalex: "open science" → 3 results', 'crossref: "open science" → 3 results'],
  );
  for (const event of searches) {
    assert.deepEqual(event.ids, [recorded.id]);
    assert.ok(!event.summary.includes('Open Science Practices'), 'no result payload in the event');
  }
});

test('search: a second run adds only what is new and appends its runs to the same search', async () => {
  const root = await newRoot();
  const first = makeDeps(root);
  const created = await research.search(first, { query: 'open science' });
  assert.equal(created.candidates.created.length, 3);

  const second = makeDeps(root, successRoutes(), ['openalex', 'crossref'], 30);
  const again = await research.search(second, { query: 'open science' });

  assert.deepEqual(again.candidates.created, [], 'nothing new the second time');
  assert.deepEqual(again.candidates.existing.sort(), created.candidates.created.sort());
  assert.equal(again.search.id, created.search.id, 'the same query maps to the same search');
  assert.equal(again.search.runs.length, 4, 'two provider runs per search');
  assert.deepEqual(
    again.search.runs.map((r) => r.new),
    [3, 0, 0, 0],
  );
  assert.equal(again.search.created, created.search.created, 'the record is not re-created');
  assert.ok(again.search.last_run > created.search.last_run);

  assert.equal((await research.list(second)).length, 3, 'no duplicate candidate objects');
});

test('search: the same query through a different provider order adds nothing new', async () => {
  const root = await newRoot();
  const first = makeDeps(root);
  const created = await research.search(first, { query: 'open science' });
  assert.equal(created.candidates.created.length, 3);

  // Reversed order: the owning provider changes, the works do not, so nothing is new.
  const reversed = makeDeps(root, successRoutes(), ['crossref', 'openalex'], 30);
  const back = await research.search(reversed, { query: 'open science' });
  assert.deepEqual(back.candidates.created, [], 'reversing the providers creates no duplicates');
  assert.deepEqual(back.candidates.existing.sort(), created.candidates.created.sort());
  assert.deepEqual(
    back.search.runs.slice(2).map((r) => r.new),
    [0, 0],
  );

  // One provider on its own: still the same works, still nothing new.
  const alone = makeDeps(root, successRoutes(), ['crossref'], 60);
  const single = await research.search(alone, { query: 'open science' });
  assert.deepEqual(single.candidates.created, []);
  assert.equal(single.candidates.existing.length, 3);
  assert.deepEqual(
    single.search.runs.slice(4).map((r) => r.new),
    [0],
  );

  assert.equal((await research.list(alone)).length, 3, 'three works, three candidate files');
});

test('search: a candidate takes the DOI a second provider knows and the first did not', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await research.search(deps, { query: 'open science' });

  const preprint = (await research.list(deps)).find((c) => c.type === 'preprint');
  assert.equal(preprint.provider, 'openalex', 'openalex ran first and owns the record');
  assert.equal(
    preprint.doi,
    '10.31224/7150',
    'openalex returned no DOI for the preprint; crossref did',
  );
  assert.equal(preprint.ext.ids.crossref, '10.31224/7150');
});

test('search: a provider that fails is a warning, and the other providers still land', async () => {
  const root = await newRoot();
  const deps = makeDeps(root, [
    { match: OPENALEX, body: fixture('openalex/search.json') },
    { match: CROSSREF, status: 500 },
  ]);

  const result = await research.search(deps, { query: 'open science' });

  assert.equal(result.candidates.created.length, 3);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /^crossref: /);
  assert.deepEqual(
    result.search.runs.map((r) => r.provider),
    ['openalex'],
    'a failed call records no run',
  );

  const events = (await deps.store.readEvents()).filter((e) => e.op === 'search');
  assert.deepEqual(
    events.map((e) => e.summary),
    ['openalex: "open science" → 3 results', 'crossref: "open science" → failed'],
    'the failed call is still audited',
  );

  const candidates = await research.list(deps);
  for (const candidate of candidates) assert.deepEqual(candidate.providers, ['openalex']);
});

test('search: every provider failing is a TOOL_MISSING that names each failure', async () => {
  const root = await newRoot();
  const deps = makeDeps(root, [
    { match: OPENALEX, status: 500 },
    { match: CROSSREF, status: 500 },
  ]);

  await assert.rejects(
    () => research.search(deps, { query: 'open science' }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'TOOL_MISSING');
      assert.equal(err.message, 'all providers failed');
      assert.ok(err.hint);
      assert.equal(err.details.length, 2);
      return true;
    },
  );

  assert.deepEqual(await research.list(deps), [], 'a failed run writes nothing');
});

test('search: refuses to touch the network when the policy has not opened it', async () => {
  const root = await newRoot({ network: false });
  const deps = makeDeps(root);

  await assert.rejects(
    () => research.search(deps, { query: 'open science' }),
    (err) => {
      assert.equal(err.code, 'POLICY');
      assert.equal(err.message, 'network access is disabled');
      assert.match(err.hint, /--allow-network/);
      return true;
    },
  );

  assert.equal(deps.fetch.calls.length, 0, 'the refusal happens before any request');
});

test('search: a missing policy file is read as closed', async () => {
  const root = await newRoot({ network: null });
  const deps = makeDeps(root);

  await assert.rejects(() => research.search(deps, { query: 'open science' }), {
    code: 'POLICY',
  });
});

test('search: --allow-network overrides a closed policy for this one run', async () => {
  const root = await newRoot({ network: false });
  const deps = makeDeps(root);

  const result = await research.search(deps, { query: 'open science', allowNetwork: true });
  assert.equal(result.candidates.created.length, 3);
});

test('search: refuses a question that does not exist', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);

  await assert.rejects(
    () => research.search(deps, { query: 'open science', question: 'RQ-9' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION');
      assert.equal(err.message, 'unknown question RQ-9');
      return true;
    },
  );
  assert.equal(deps.fetch.calls.length, 0);
});

test('search: refuses an id that is not a research question', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);

  await assert.rejects(() => research.search(deps, { query: 'open science', question: 'H-1' }), {
    code: 'VALIDATION',
  });
});

test('search: refuses an empty query', async () => {
  const deps = makeDeps(await newRoot());
  await assert.rejects(() => research.search(deps, { query: '   ' }), { code: 'USAGE' });
});

test('search: narrows to the providers the caller named', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);

  const result = await research.search(deps, { query: 'open science', providers: ['crossref'] });

  assert.deepEqual(result.search.providers, ['crossref']);
  assert.equal(deps.fetch.calls.length, 1);
  assert.match(deps.fetch.calls[0].url, /crossref/);
});

test('search: refuses a provider the workspace has not configured', async () => {
  const deps = makeDeps(await newRoot());
  await assert.rejects(() => research.search(deps, { query: 'x', providers: ['pubmed'] }), {
    code: 'USAGE',
  });
});

test('search: flags a preprint for approval instead of hiding it', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);

  await research.search(deps, { query: 'open science' });
  const candidates = await research.list(deps);
  const preprint = candidates.find((c) => c.type === 'preprint');

  assert.ok(preprint, 'the preprint is listed');
  assert.equal(preprint.needs_approval, true);
  for (const other of candidates.filter((c) => c.type !== 'preprint')) {
    assert.equal(other.needs_approval, false);
  }
});

test('search: honours an explicit --from and --limit over the policy', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);

  const result = await research.search(deps, { query: 'open science', from: 2022, limit: 5 });

  assert.equal(result.search.filters.from, 2022);
  assert.equal(result.search.filters.limit, 5);
  assert.match(deps.fetch.calls[0].url, /2022-01-01/);
  assert.match(deps.fetch.calls[0].url, /per-page=5/);
  assert.equal(result.candidates.created.length, 2, 'the 2021 work is filtered out client-side');
});

test('list: filters by state and by question', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await addQuestion(deps.store, 1, 'How do open science practices spread?');
  await research.search(deps, { query: 'open science', question: 'RQ-1' });

  assert.equal((await research.list(deps, { state: 'candidate' })).length, 3);
  assert.equal((await research.list(deps, { state: 'accepted' })).length, 0);
  assert.equal((await research.list(deps, { question: 'RQ-1' })).length, 3);
  assert.equal((await research.list(deps, { question: 'RQ-2' })).length, 0);
  await assert.rejects(() => research.list(deps, { state: 'bogus' }), { code: 'USAGE' });
});

test('show: returns a candidate or a search, and refuses anything else', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  const result = await research.search(deps, { query: 'open science' });
  const id = result.candidates.created[0];

  assert.equal((await research.show(deps, id)).id, id);
  assert.equal((await research.show(deps, result.search.id)).id, result.search.id);

  await assert.rejects(() => research.show(deps, 'CLAIM-0123456789'), { code: 'USAGE' });
  await assert.rejects(() => research.show(deps, 'CAND-0000000000'), { code: 'USAGE' });
});

test('search: a DOI learned by a later run fills the record instead of filing the work twice', async () => {
  const root = await newRoot();
  // OpenAlex alone first: it reports no DOI for the preprint, so that work is filed under its
  // title and year.
  const openalexOnly = makeDeps(
    root,
    [{ match: OPENALEX, body: fixture('openalex/search.json') }],
    ['openalex'],
  );
  const first = await research.search(openalexOnly, { query: 'open science' });
  assert.equal(first.candidates.created.length, 3);
  const before = (await research.list(openalexOnly)).find((c) => c.type === 'preprint');
  assert.equal(before.doi, null);

  // Crossref alone next: it knows the DOI, so the work's identity moves to the DOI key. It is
  // still the same paper, so nothing is new.
  const crossrefOnly = makeDeps(
    root,
    [{ match: CROSSREF, body: fixture('crossref/search.json') }],
    ['crossref'],
    30,
  );
  const second = await research.search(crossrefOnly, { query: 'open science' });

  assert.deepEqual(second.candidates.created, [], 'the DOI is new, the work is not');
  assert.equal(second.candidates.existing.length, 3);
  assert.deepEqual(
    second.search.runs.slice(1).map((r) => r.new),
    [0],
    'a filled-in record is not counted as a new candidate',
  );

  const stored = await research.list(crossrefOnly);
  assert.equal(stored.length, 3, 'three works, three candidate files, before and after');

  const after = stored.find((c) => c.id === before.id);
  assert.equal(after.doi, '10.31224/7150', 'the record took the DOI crossref reported');
  assert.equal(after.provider, 'openalex', 'the provider that recorded it still owns it');
  assert.deepEqual(after.providers, ['openalex', 'crossref']);
  assert.equal(after.ext.ids.crossref, '10.31224/7150');
  assert.equal(after.state, 'candidate', 'filling a field does not reset the review');
});

test('accept: creates a source with the candidate identifiers and links the candidate to it', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await addQuestion(deps.store, 1, 'How do open science practices spread?');
  await research.search(deps, { query: 'open science', question: 'RQ-1' });

  const candidate = (await research.list(deps)).find((c) => c.type === 'article' && c.doi);
  const { candidate: accepted, source, created } = await research.accept(deps, candidate.id);

  assert.equal(created, true);
  assert.equal(source.schema, 'phdude.source');
  assert.equal(source.title, candidate.title);
  assert.deepEqual(source.authors, candidate.authors);
  assert.equal(source.year, candidate.year);
  assert.equal(source.venue, candidate.venue);
  assert.equal(source.type, 'article');
  assert.equal(source.state, 'candidate', 'an accepted source is not canonical knowledge');
  assert.equal(source.identifiers.doi, candidate.doi);
  assert.equal(source.identifiers.url, candidate.url);
  assert.deepEqual(source.provenance, { method: 'imported', derived_from: [] });
  assert.deepEqual(source.ext.research, {
    candidate: candidate.id,
    provider: candidate.provider,
    external_id: candidate.external_id,
    accepted_by: actor,
  });

  assert.equal(accepted.state, 'accepted');
  assert.equal(accepted.accepted_as, source.id);
  assert.equal((await deps.store.readEntity(source.id)).id, source.id, 'the source is on disk');

  const events = (await deps.store.readEvents()).filter((e) => e.op === 'research');
  assert.equal(events.length, 1, 'accepting writes exactly one event');
  assert.deepEqual(events[0].ids, [candidate.id, source.id]);
  assert.equal(events[0].summary, `accepted ${candidate.id} as ${source.id}`);
});

test('accept: --type overrides the type the provider reported', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await research.search(deps, { query: 'open science' });
  const candidate = (await research.list(deps)).find((c) => c.type === 'article');

  const { source } = await research.accept(deps, candidate.id, { type: 'report' });
  assert.equal(source.type, 'report');

  await assert.rejects(() => research.accept(deps, candidate.id, { type: 'zine' }), {
    code: 'USAGE',
  });
});

test('accept: a preprint the policy flagged needs --approve-preprint', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await research.search(deps, { query: 'open science' });
  const preprint = (await research.list(deps)).find((c) => c.needs_approval);

  await assert.rejects(
    () => research.accept(deps, preprint.id),
    (err) => {
      assert.equal(err.code, 'USAGE');
      assert.match(err.hint, /--approve-preprint/);
      return true;
    },
  );
  assert.equal((await deps.store.readEntity(preprint.id)).state, 'candidate', 'nothing changed');

  const { source } = await research.accept(deps, preprint.id, { approvePreprint: true });
  assert.equal(source.type, 'preprint');
  assert.equal((await deps.store.readEntity(preprint.id)).state, 'accepted');
});

test('accept: an already-recorded source is linked to, not rewritten', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await research.search(deps, { query: 'open science' });
  const candidate = (await research.list(deps)).find((c) => c.type === 'article');

  const first = await research.accept(deps, candidate.id);
  const edited = { ...first.source, tags: ['read'] };
  await deps.store.writeEntity(edited);

  // A second candidate for the same work - same title and year, so the same SRC id.
  const twin = {
    ...candidate,
    id: 'CAND-0000000001',
    provider: 'crossref',
    external_id: 'twin',
    state: 'candidate',
  };
  delete twin.accepted_as;
  await deps.store.writeEntity(twin);

  const second = await research.accept(deps, twin.id);
  assert.equal(second.created, false);
  assert.equal(second.source.id, first.source.id);
  assert.deepEqual(second.source.tags, ['read'], 'the recorded source is left exactly as it was');
  assert.equal((await deps.store.readEntity(twin.id)).accepted_as, first.source.id);
});

test('accept and dismiss: refuse a candidate that was already decided', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await research.search(deps, { query: 'open science' });
  const [a, b] = (await research.list(deps)).filter((c) => !c.needs_approval);

  await research.accept(deps, a.id);
  await assert.rejects(() => research.accept(deps, a.id), { code: 'POLICY' });
  await assert.rejects(() => research.dismiss(deps, a.id, { reason: 'no' }), { code: 'POLICY' });

  await research.dismiss(deps, b.id, { reason: 'measures a different construct' });
  await assert.rejects(() => research.accept(deps, b.id), { code: 'POLICY' });
});

test('accept: refuses an id that is not a candidate, and one that does not exist', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await assert.rejects(() => research.accept(deps, 'CLAIM-0123456789'), { code: 'USAGE' });
  await assert.rejects(() => research.accept(deps, 'CAND-0000000000'), { code: 'USAGE' });
});

test('dismiss: records the reason and writes one event', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await research.search(deps, { query: 'open science' });
  const candidate = (await research.list(deps))[0];

  await assert.rejects(() => research.dismiss(deps, candidate.id), { code: 'USAGE' });
  await assert.rejects(() => research.dismiss(deps, candidate.id, { reason: '   ' }), {
    code: 'USAGE',
  });

  const dismissed = await research.dismiss(deps, candidate.id, { reason: 'wrong population' });
  assert.equal(dismissed.state, 'dismissed');
  assert.equal(dismissed.reason, 'wrong population');

  const events = (await deps.store.readEvents()).filter((e) => e.op === 'research');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].ids, [candidate.id]);
  assert.equal(events[0].summary, `dismissed ${candidate.id}: wrong population`);
});

// `fresh` re-runs recorded searches, so the searches it re-runs have to be old. The clock is
// wound back for the first run rather than the test waiting six months.
function makeDepsAt(root, at, routes = successRoutes(), names = ['openalex', 'crossref']) {
  const fetch = fakeFetch(routes);
  return {
    store: new FsStore(root),
    clock: () => at,
    actor,
    fetch,
    providers: buildProviders(names, { fetch, env: {}, version: '0.3.0' }),
  };
}

test('fresh: re-runs only the stale searches and reports only new candidates', async () => {
  const root = await newRoot();
  await addQuestion(new FsStore(root), 1, 'How do open science practices spread?');

  const old = makeDepsAt(root, '2025-01-01T00:00:00Z');
  const stale = await research.search(old, { query: 'open science', question: 'RQ-1' });
  assert.equal(stale.candidates.created.length, 3);

  const recent = makeDepsAt(root, '2026-09-01T00:00:00Z');
  const current = await research.search(recent, { query: 'reproducible pipelines' });

  // The stale search finds the same works again, so it re-runs and reports nothing new.
  const now = makeDepsAt(root, '2026-09-07T00:00:00Z');
  const result = await research.fresh(now, {});

  assert.deepEqual(result.reran, [stale.search.id], 'only the aged search is due');
  assert.deepEqual(result.newCandidates, []);
  assert.deepEqual(result.warnings, []);

  const reran = await now.store.readEntity(stale.search.id);
  assert.equal(reran.runs.length, 4, 'the re-run appended its own runs');
  assert.equal(reran.last_run, '2026-09-07T00:00:00Z');
  assert.equal(
    (await now.store.readEntity(current.search.id)).runs.length,
    2,
    'the recent search was left alone',
  );
});

test('fresh: --all re-runs every recorded search, --question narrows to one', async () => {
  const root = await newRoot();
  await addQuestion(new FsStore(root), 1, 'How do open science practices spread?');
  await addQuestion(new FsStore(root), 2, 'What makes a pipeline reproducible?');

  const old = makeDepsAt(root, '2025-01-01T00:00:00Z');
  const one = await research.search(old, { query: 'open science', question: 'RQ-1' });
  const two = await research.search(makeDepsAt(root, '2026-09-01T00:00:00Z'), {
    query: 'reproducible pipelines',
    question: 'RQ-2',
  });

  const now = makeDepsAt(root, '2026-09-07T00:00:00Z');
  assert.deepEqual((await research.fresh(now, { question: 'RQ-2' })).reran, []);

  const all = await research.fresh(makeDepsAt(root, '2026-09-07T00:00:00Z'), { all: true });
  assert.deepEqual(all.reran.sort(), [one.search.id, two.search.id].sort());

  const scoped = await research.fresh(makeDepsAt(root, '2026-09-07T00:00:00Z'), {
    question: 'RQ-2',
    all: true,
  });
  assert.deepEqual(scoped.reran, [two.search.id]);
});

test('fresh: re-runs a search with the providers and filters it was recorded with', async () => {
  const root = await newRoot();
  const old = makeDepsAt(
    root,
    '2025-01-01T00:00:00Z',
    [{ match: CROSSREF, body: fixture('crossref/search.json') }],
    ['crossref'],
  );
  const recorded = await research.search(old, { query: 'open science', from: 2022, limit: 5 });
  assert.deepEqual(recorded.search.providers, ['crossref']);

  const now = makeDepsAt(root, '2026-09-07T00:00:00Z');
  await research.fresh(now, {});

  assert.equal(now.fetch.calls.length, 1, 'only the provider the search recorded was called');
  assert.match(now.fetch.calls[0].url, /api\.crossref\.org/);
  assert.match(now.fetch.calls[0].url, /from-pub-date%3A2022/);
  assert.match(now.fetch.calls[0].url, /rows=5/);
});

test('search: a provider API key never reaches a warning or an event summary', async () => {
  const root = await newRoot();
  const keys = { PHDUDE_S2_API_KEY: 's2-secret-key', PHDUDE_NCBI_API_KEY: 'ncbi-secret-key' };
  const fetch = fakeFetch([
    { match: OPENALEX, body: fixture('openalex/search.json') },
    { match: 'eutils.ncbi.nlm.nih.gov', status: 500, body: 'unwell' },
  ]);
  const deps = {
    store: new FsStore(root),
    clock: () => '2026-09-07T10:00:00Z',
    actor,
    fetch,
    providers: buildProviders(['openalex', 'pubmed'], { fetch, env: keys, version: '0.3.0' }),
  };

  // NCBI's key travels as a query parameter, so a provider error that echoed its request would
  // put the key in the event log the researcher reads and commits.
  const result = await research.search(deps, { query: 'open science' });
  assert.deepEqual(result.warnings, ['pubmed: HTTP 500']);

  const events = await deps.store.readEvents();
  assert.ok(events.some((e) => e.summary === 'pubmed: "open science" \u2192 failed'));

  const shown = JSON.stringify([result.warnings, events]);
  for (const key of Object.values(keys)) {
    assert.ok(!shown.includes(key), `the API key reached the researcher: ${shown}`);
  }
});

test('search: --provider can only narrow, never widen, the policy list', async () => {
  const root = await newRoot();
  const deps = makeDeps(root, successRoutes(), ['openalex']);

  await assert.rejects(
    () => research.search(deps, { query: 'open science', providers: ['semantic-scholar'] }),
    (err) => {
      assert.equal(err.code, 'USAGE');
      assert.equal(err.message, 'provider semantic-scholar is not in the workspace policy');
      assert.match(err.hint, /research-policy\.yaml/);
      return true;
    },
  );
  assert.equal(deps.fetch.calls.length, 0, 'nothing was dispatched');

  // The same flag naming a provider the policy does list still narrows to it.
  const narrowed = makeDeps(root, successRoutes(), ['openalex', 'crossref']);
  await research.search(narrowed, { query: 'open science', providers: ['crossref'] });
  assert.equal(narrowed.fetch.calls.length, 1);
  assert.match(narrowed.fetch.calls[0].url, /api\.crossref\.org/);
});

test('fresh: refuses to touch the network when the policy has not opened it', async () => {
  const root = await newRoot({ network: false });
  const deps = makeDepsAt(root, '2026-09-07T00:00:00Z');

  await assert.rejects(() => research.fresh(deps, {}), { code: 'POLICY' });
  assert.equal(deps.fetch.calls.length, 0, 'no request was made');

  assert.deepEqual((await research.fresh(deps, { allowNetwork: true })).reran, []);
});

test('fresh: refuses a question that does not exist', async () => {
  const root = await newRoot();
  const deps = makeDepsAt(root, '2026-09-07T00:00:00Z');
  await assert.rejects(() => research.fresh(deps, { question: 'RQ-9' }), { code: 'VALIDATION' });
});

test('fresh: skips a search whose question is gone and re-runs the rest', async () => {
  const root = await newRoot();
  await addQuestion(new FsStore(root), 1, 'How do open science practices spread?');
  await addQuestion(new FsStore(root), 2, 'What makes a pipeline reproducible?');

  const old = makeDepsAt(root, '2025-01-01T00:00:00Z');
  const orphaned = await research.search(old, { query: 'open science', question: 'RQ-1' });
  const kept = await research.search(makeDepsAt(root, '2025-01-01T00:00:00Z'), {
    query: 'reproducible pipelines',
    question: 'RQ-2',
  });

  // Nothing in the CLI deletes a question, but a hand-edited workspace can, and one unrunnable
  // record must not throw away the searches that ran before it in the same invocation.
  await rm(join(root, 'research', 'questions', 'RQ-1.yaml'));

  const now = makeDepsAt(root, '2026-09-07T00:00:00Z');
  const result = await research.fresh(now, {});

  assert.deepEqual(result.reran, [kept.search.id], 'the runnable search still ran');
  assert.deepEqual(result.warnings, [`skipped ${orphaned.search.id}: unknown question RQ-1`]);
});

test('fresh: an error that is not VALIDATION still aborts the run', async () => {
  const root = await newRoot();
  await addQuestion(new FsStore(root), 1, 'How do open science practices spread?');
  await research.search(makeDepsAt(root, '2025-01-01T00:00:00Z'), {
    query: 'open science',
    question: 'RQ-1',
  });

  // Every provider unwell is TOOL_MISSING, not VALIDATION: nothing about the record is wrong,
  // so reporting it as a skipped search would claim the literature was checked when it was not.
  const deps = makeDepsAt(root, '2026-09-07T00:00:00Z', [
    { match: OPENALEX, status: 500, body: 'unwell' },
    { match: CROSSREF, status: 500, body: 'unwell' },
  ]);
  await assert.rejects(() => research.fresh(deps, {}), { code: 'TOOL_MISSING' });
});

test('fresh: a search whose providers were removed from the policy is skipped, not fatal', async () => {
  const root = await newRoot();
  const store = new FsStore(root);
  await addQuestion(store, 1, 'How do open science practices spread?');
  await addQuestion(store, 2, 'What makes a pipeline reproducible?');

  const both = await research.search(makeDepsAt(root, '2025-01-01T00:00:00Z'), {
    query: 'open science',
    question: 'RQ-1',
  });
  const crossrefOnly = await research.search(
    makeDepsAt(root, '2025-01-01T00:00:00Z', successRoutes(), ['crossref']),
    { query: 'reproducible pipelines', question: 'RQ-2', providers: ['crossref'] },
  );
  assert.deepEqual(crossrefOnly.search.providers, ['crossref']);

  // The researcher narrowed `providers:` to openalex. One recorded search still overlaps it and
  // one does not; neither may take the whole run down with it.
  const now = makeDepsAt(root, '2026-09-07T00:00:00Z', successRoutes(), ['openalex']);
  const result = await research.fresh(now, {});

  assert.deepEqual(result.reran, [both.search.id], 'the search that still overlaps ran');
  assert.deepEqual(result.warnings, [
    `${both.search.id}: provider(s) crossref no longer configured`,
    `skipped ${crossrefOnly.search.id}: provider(s) crossref no longer configured`,
  ]);
  assert.ok(
    now.fetch.calls.every((call) => call.url.includes('api.openalex.org')),
    'only the provider the policy still lists was called',
  );
});

test('search: the same title and year under a different DOI is a different work', async () => {
  const root = await newRoot();
  const first = makeDeps(
    root,
    [{ match: OPENALEX, body: fixture('openalex/search.json') }],
    ['openalex'],
  );
  await research.search(first, { query: 'open science' });

  const recorded = (await research.list(first)).find((c) => c.doi !== null);
  assert.ok(recorded, 'the fixture records at least one candidate with a DOI');

  // Same title, same year, a DOI that disagrees. Two DOIs are two registered works, so this is
  // not the null-DOI carry-over - filling one in here would merge two different papers.
  const rival = makeDeps(
    root,
    [
      {
        match: OPENALEX,
        body: {
          results: [
            {
              id: 'https://openalex.org/W9999999999',
              doi: 'https://doi.org/10.9999/rival.2021.0001',
              display_name: recorded.title,
              publication_year: recorded.year,
              language: 'en',
              type: 'article',
              authorships: [{ author: { display_name: 'Rival Author' } }],
            },
          ],
        },
      },
    ],
    ['openalex'],
    60,
  );
  const second = await research.search(rival, { query: 'open science' });

  assert.equal(second.candidates.created.length, 1, 'the rival DOI is a new candidate');
  const stored = (await research.list(rival)).filter(
    (c) => c.title === recorded.title && c.year === recorded.year,
  );
  assert.equal(stored.length, 2, 'two DOIs under one title stay two records');
  assert.deepEqual(
    stored.map((c) => c.doi).sort(),
    [recorded.doi, '10.9999/rival.2021.0001'].sort(),
  );
});

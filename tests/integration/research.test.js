import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
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

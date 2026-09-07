import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchWithPolicy, retryAfterMs, userAgent } from '../../../src/adapters/search/http.js';
import { buildProviders, PROVIDER_FACTORIES } from '../../../src/adapters/search/index.js';
import { crossref } from '../../../src/adapters/search/crossref.js';
import { openalex } from '../../../src/adapters/search/openalex.js';
import { fakeFetch } from '../../support/fake-fetch.js';

const fx = (name) =>
  readFileSync(new URL(`../../fixtures/search/${name}`, import.meta.url), 'utf8');
const URL_OK = 'https://example.org/works';

test('userAgent: identifies phdude and its version', () => {
  assert.equal(userAgent('0.3.0'), 'phdude/0.3.0 (+https://github.com/LucioY250/phdude)');
});

test('retryAfterMs: the header wins, capped at two seconds', () => {
  assert.equal(retryAfterMs('0'), 0);
  assert.equal(retryAfterMs('1'), 1000);
  assert.equal(retryAfterMs('30'), 2000);
  assert.equal(retryAfterMs(null), 1000);
  assert.equal(retryAfterMs('soon'), 1000);
  assert.equal(retryAfterMs('-5'), 1000);
});

test('fetchWithPolicy: retries once after 429 and returns the second response', async () => {
  const fetch = fakeFetch([
    { match: URL_OK, status: 429, headers: { 'retry-after': '0' }, times: 1 },
    { match: URL_OK, body: { ok: true } },
  ]);
  const res = await fetchWithPolicy(fetch, URL_OK, { provider: 'demo' });
  assert.equal(res.status, 200);
  assert.equal(fetch.calls.length, 2);
});

test('fetchWithPolicy: retries once after 503', async () => {
  const fetch = fakeFetch([
    { match: URL_OK, status: 503, headers: { 'retry-after': '0' }, times: 1 },
    { match: URL_OK, body: { ok: true } },
  ]);
  assert.equal((await fetchWithPolicy(fetch, URL_OK, { provider: 'demo' })).status, 200);
});

test('fetchWithPolicy: retries once and no more', async () => {
  const fetch = fakeFetch([{ match: URL_OK, status: 429, headers: { 'retry-after': '0' } }]);
  await assert.rejects(fetchWithPolicy(fetch, URL_OK, { provider: 'demo' }), (err) => {
    assert.equal(err.code, 'TOOL_MISSING');
    assert.match(err.message, /demo/);
    return true;
  });
  assert.equal(fetch.calls.length, 2);
});

test('fetchWithPolicy: a timeout is a TOOL_MISSING naming the provider', async () => {
  const fetch = fakeFetch([{ match: URL_OK, delayMs: 200 }]);
  await assert.rejects(
    fetchWithPolicy(fetch, URL_OK, { provider: 'demo', timeoutMs: 10 }),
    (err) => {
      assert.equal(err.name, 'PhdudeError');
      assert.equal(err.code, 'TOOL_MISSING');
      assert.match(err.message, /demo/);
      assert.equal(err.hint, 'check your connection or provider status');
      return true;
    },
  );
});

test('fetchWithPolicy: a caller abort rejects without retrying', async () => {
  const fetch = fakeFetch([{ match: URL_OK, body: { ok: true } }]);
  await assert.rejects(
    fetchWithPolicy(fetch, URL_OK, { provider: 'demo', signal: AbortSignal.abort() }),
    (err) => {
      assert.equal(err.code, 'TOOL_MISSING');
      return true;
    },
  );
});

test('fetchWithPolicy: a 4xx that is not 429 is a VALIDATION carrying the status', async () => {
  const fetch = fakeFetch([{ match: URL_OK, status: 404, body: 'nope' }]);
  await assert.rejects(fetchWithPolicy(fetch, URL_OK, { provider: 'demo' }), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /demo.*404/);
    return true;
  });
  assert.equal(fetch.calls.length, 1, 'a 404 is not retried');
});

test('fetchWithPolicy: a 5xx is a TOOL_MISSING', async () => {
  const fetch = fakeFetch([{ match: URL_OK, status: 500, body: 'boom' }]);
  await assert.rejects(fetchWithPolicy(fetch, URL_OK, { provider: 'demo' }), (err) => {
    assert.equal(err.code, 'TOOL_MISSING');
    assert.match(err.message, /demo.*500/);
    return true;
  });
});

test('fetchWithPolicy: a transport failure is a TOOL_MISSING', async () => {
  const fetch = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(fetchWithPolicy(fetch, URL_OK, { provider: 'demo' }), (err) => {
    assert.equal(err.code, 'TOOL_MISSING');
    assert.match(err.message, /demo: fetch failed/);
    return true;
  });
});

test('openalex: sends the user agent and the polite mailto when one is configured', async () => {
  const fetch = fakeFetch([{ match: 'api.openalex.org', body: fx('openalex/search.json') }]);
  const provider = openalex({ fetch, env: {}, version: '0.3.0', mailto: 'ada@example.org' });
  await provider.search('open science', { limit: 3 });
  const [call] = fetch.calls;
  assert.match(call.url, /mailto=ada%40example\.org/);
  assert.equal(
    call.init.headers['user-agent'],
    'phdude/0.3.0 (+https://github.com/LucioY250/phdude)',
  );
  assert.match(call.url, /per-page=3/);
});

test('openalex: omits mailto when the workspace has no author email', async () => {
  const fetch = fakeFetch([{ match: 'api.openalex.org', body: fx('openalex/search.json') }]);
  await openalex({ fetch, env: {}, version: '0.3.0' }).search('open science', { limit: 3 });
  assert.ok(!fetch.calls[0].url.includes('mailto'));
});

test('openalex: maps a work into a candidate', async () => {
  const fetch = fakeFetch([{ match: 'api.openalex.org', body: fx('openalex/search.json') }]);
  const [first, second, third] = await openalex({ fetch, env: {}, version: '0.3.0' }).search(
    'open science',
    { limit: 3 },
  );

  assert.deepEqual(first, {
    provider: 'openalex',
    external_id: 'W3138516171',
    title: 'Open Science Practices in Applied Research',
    authors: ['Ada Lovelace', 'Charles Babbage'],
    year: 2021,
    venue: 'Journal of Research Practice',
    doi: '10.1109/iccv48922.2021.00986',
    url: 'https://example.org/articles/open-science-practices',
    abstract: 'Open science practices are spreading across applied fields.',
    type: 'article',
    open_access: true,
    cited_by: 128,
  });
  assert.equal(second.type, 'preprint');
  assert.equal(second.doi, null);
  assert.equal(second.abstract, null);
  assert.equal(third.type, 'chapter');
  assert.equal(third.open_access, false);
});

test('openalex: an unknown work type becomes "other"', async () => {
  const body = {
    results: [
      {
        id: 'https://openalex.org/W1',
        display_name: 'A Conference Paper',
        type: 'conference-paper',
        publication_year: 2024,
      },
    ],
  };
  const fetch = fakeFetch([{ match: 'api.openalex.org', body }]);
  const [candidate] = await openalex({ fetch, env: {}, version: '0.3.0' }).search('x', {});
  assert.equal(candidate.type, 'other');
  assert.deepEqual(candidate.authors, []);
  assert.equal(candidate.venue, null);
  assert.equal(candidate.open_access, null);
  assert.equal(candidate.cited_by, null);
});

test('openalex: a work with no usable title is dropped rather than half-mapped', async () => {
  const body = {
    results: [
      { id: 'https://openalex.org/W1', display_name: '   ', type: 'article' },
      { id: 'https://openalex.org/W2', display_name: 'Real Title', type: 'article' },
    ],
  };
  const fetch = fakeFetch([{ match: 'api.openalex.org', body }]);
  const results = await openalex({ fetch, env: {}, version: '0.3.0' }).search('x', {});
  assert.deepEqual(
    results.map((c) => c.external_id),
    ['W2'],
  );
});

test('openalex: a response without a results array is a VALIDATION', async () => {
  const fetch = fakeFetch([{ match: 'api.openalex.org', body: { meta: { count: 0 } } }]);
  await assert.rejects(openalex({ fetch, env: {}, version: '0.3.0' }).search('x', {}), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /openalex/);
    return true;
  });
});

test('crossref: sends the user agent and the polite mailto, and asks for rows', async () => {
  const fetch = fakeFetch([{ match: 'api.crossref.org', body: fx('crossref/search.json') }]);
  const provider = crossref({ fetch, env: {}, version: '0.3.0', mailto: 'ada@example.org' });
  await provider.search('open science', { limit: 3 });
  const [call] = fetch.calls;
  assert.match(call.url, /rows=3/);
  assert.match(call.url, /mailto=ada%40example\.org/);
  assert.equal(
    call.init.headers['user-agent'],
    'phdude/0.3.0 (+https://github.com/LucioY250/phdude)',
  );
});

test('crossref: maps an item into a candidate and strips the JATS abstract markup', async () => {
  const fetch = fakeFetch([{ match: 'api.crossref.org', body: fx('crossref/search.json') }]);
  const [first, second, third] = await crossref({ fetch, env: {}, version: '0.3.0' }).search(
    'open science',
    { limit: 3 },
  );

  assert.deepEqual(first, {
    provider: 'crossref',
    external_id: '10.1109/iccv48922.2021.00986',
    title: 'Open Science Practices in Applied Research',
    authors: ['Ada Lovelace', 'Charles Babbage'],
    year: 2021,
    venue: 'Journal of Research Practice',
    doi: '10.1109/iccv48922.2021.00986',
    url: 'https://doi.org/10.1109/iccv48922.2021.00986',
    abstract: 'Abstract Open science practices are spreading across applied fields.',
    type: 'article',
    open_access: null,
    cited_by: 128,
  });
  assert.equal(second.type, 'preprint');
  assert.deepEqual(second.authors, ['Grace Hopper', 'Reproducibility Working Group']);
  assert.equal(second.venue, null);
  assert.equal(third.type, 'chapter');
  assert.equal(third.year, 2022);
});

test('crossref: a response without message.items is a VALIDATION', async () => {
  const fetch = fakeFetch([{ match: 'api.crossref.org', body: { status: 'ok' } }]);
  await assert.rejects(crossref({ fetch, env: {}, version: '0.3.0' }).search('x', {}), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /crossref/);
    return true;
  });
});

test('buildProviders: builds the named providers in order', () => {
  const providers = buildProviders(['crossref', 'openalex'], {
    fetch: () => {},
    env: {},
    version: '0.3.0',
    mailto: null,
  });
  assert.deepEqual(
    providers.map((p) => p.name),
    ['crossref', 'openalex'],
  );
});

test('buildProviders: an unknown provider is a USAGE error listing what is available', () => {
  assert.throws(
    () => buildProviders(['scopus'], { fetch: () => {}, env: {}, version: '0.3.0' }),
    (err) => {
      assert.equal(err.code, 'USAGE');
      assert.equal(err.message, 'unknown provider scopus');
      assert.equal(err.hint, `available: ${Object.keys(PROVIDER_FACTORIES).join(', ')}`);
      return true;
    },
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchWithPolicy, retryAfterMs, userAgent } from '../../../src/adapters/search/http.js';
import { buildProviders, PROVIDER_FACTORIES } from '../../../src/adapters/search/index.js';
import { arxiv } from '../../../src/adapters/search/arxiv.js';
import { crossref } from '../../../src/adapters/search/crossref.js';
import { openalex } from '../../../src/adapters/search/openalex.js';
import { pubmed } from '../../../src/adapters/search/pubmed.js';
import { semanticScholar } from '../../../src/adapters/search/semantic-scholar.js';
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

test('arxiv: declares filtersDateClientSide', () => {
  const provider = arxiv({ fetch: () => {}, version: '0.3.0' });
  assert.equal(provider.filtersDateClientSide, true);
});

test('arxiv: sends the search query, limit and sortBy in the request URL', async () => {
  const fetch = fakeFetch([{ match: 'export.arxiv.org', body: fx('arxiv/search.xml') }]);
  await arxiv({ fetch, version: '0.3.0' }).search('open science', { limit: 3 });
  const [call] = fetch.calls;
  assert.match(call.url, /search_query=all%3Aopen\+science/);
  assert.match(call.url, /max_results=3/);
  assert.match(call.url, /sortBy=relevance/);
  assert.equal(
    call.init.headers['user-agent'],
    'phdude/0.3.0 (+https://github.com/LucioY250/phdude)',
  );
});

test('arxiv: maps an entry into a candidate, stripping the version off the id', async () => {
  const fetch = fakeFetch([{ match: 'export.arxiv.org', body: fx('arxiv/search.xml') }]);
  const [first, second, third] = await arxiv({ fetch, version: '0.3.0' }).search('open science', {
    limit: 3,
  });

  assert.deepEqual(first, {
    provider: 'arxiv',
    external_id: '2304.09999',
    title: 'A Preprint on Reproducible Pipelines',
    authors: ['Grace Hopper'],
    year: 2023,
    venue: null,
    doi: null,
    url: 'http://arxiv.org/pdf/2304.09999v2',
    abstract: 'Open science practices are spreading across applied fields.',
    type: 'preprint',
    open_access: true,
    cited_by: null,
  });
  assert.deepEqual(second.authors, ['Ada Lovelace', 'Charles Babbage']);
  assert.equal(second.doi, '10.48550/arxiv.2101.00001');
  assert.equal(third.external_id, '1906.01234');
  assert.equal(third.year, 2019);
});

test('arxiv: applies the from filter client-side on the published year', async () => {
  const fetch = fakeFetch([{ match: 'export.arxiv.org', body: fx('arxiv/search.xml') }]);
  const results = await arxiv({ fetch, version: '0.3.0' }).search('open science', {
    from: 2021,
    limit: 3,
  });
  assert.deepEqual(
    results.map((c) => c.year),
    [2023, 2021],
  );
  assert.ok(!fetch.calls[0].url.includes('2021'), 'the year never reaches the request URL');
});

test('arxiv: a response that is not an Atom feed is a VALIDATION', async () => {
  const fetch = fakeFetch([{ match: 'export.arxiv.org', body: fx('arxiv/malformed.txt') }]);
  await assert.rejects(arxiv({ fetch, version: '0.3.0' }).search('x', {}), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /arxiv/);
    return true;
  });
});

test('arxiv: an entry with no usable title is dropped rather than half-mapped', async () => {
  const body = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><id>http://arxiv.org/abs/2000.00001v1</id><title>   </title></entry>
    <entry><id>http://arxiv.org/abs/2000.00002v1</id><title>Real Title</title></entry>
  </feed>`;
  const fetch = fakeFetch([{ match: 'export.arxiv.org', body }]);
  const results = await arxiv({ fetch, version: '0.3.0' }).search('x', {});
  assert.deepEqual(
    results.map((c) => c.external_id),
    ['2000.00002'],
  );
});

test('semantic-scholar: sends the query, limit, year and fields in the request URL', async () => {
  const fetch = fakeFetch([
    { match: 'api.semanticscholar.org', body: fx('semantic-scholar/search.json') },
  ]);
  await semanticScholar({ fetch, env: {}, version: '0.3.0' }).search('open science', {
    from: 2021,
    limit: 3,
  });
  const [call] = fetch.calls;
  assert.match(call.url, /limit=3/);
  assert.match(decodeURIComponent(call.url), /year=2021-/);
  assert.match(decodeURIComponent(call.url), /fields=title,authors,year/);
});

test('semantic-scholar: sends x-api-key only when PHDUDE_S2_API_KEY is set', async () => {
  const fetch = fakeFetch([
    { match: 'api.semanticscholar.org', body: fx('semantic-scholar/search.json') },
  ]);
  await semanticScholar({
    fetch,
    env: { PHDUDE_S2_API_KEY: 'secret-key' },
    version: '0.3.0',
  }).search('open science', { limit: 3 });
  assert.equal(fetch.calls[0].init.headers['x-api-key'], 'secret-key');
});

test('semantic-scholar: omits x-api-key when no key is configured', async () => {
  const fetch = fakeFetch([
    { match: 'api.semanticscholar.org', body: fx('semantic-scholar/search.json') },
  ]);
  await semanticScholar({ fetch, env: {}, version: '0.3.0' }).search('open science', { limit: 3 });
  assert.equal(fetch.calls[0].init.headers['x-api-key'], undefined);
});

test('semantic-scholar: maps a paper into a candidate and its publicationType into a Candidate type', async () => {
  const fetch = fakeFetch([
    { match: 'api.semanticscholar.org', body: fx('semantic-scholar/search.json') },
  ]);
  const [first, second, third] = await semanticScholar({
    fetch,
    env: {},
    version: '0.3.0',
  }).search('open science', { limit: 3 });

  assert.deepEqual(first, {
    provider: 'semantic-scholar',
    external_id: '649def34f8be52c8b66281af98ae884c09aef38',
    title: 'Open Science Practices in Applied Research',
    authors: ['Ada Lovelace', 'Charles Babbage'],
    year: 2021,
    venue: 'Journal of Research Practice',
    doi: '10.1109/iccv48922.2021.00986',
    url: 'https://www.semanticscholar.org/paper/649def34f8be52c8b66281af98ae884c09aef38',
    abstract: 'Open science practices are spreading across applied fields.',
    type: 'article',
    open_access: true,
    cited_by: 128,
  });
  assert.equal(second.type, 'other');
  assert.equal(second.doi, null);
  assert.equal(third.type, 'chapter');
  assert.equal(third.open_access, false);
});

test('semantic-scholar: a response without a data array is a VALIDATION', async () => {
  const fetch = fakeFetch([{ match: 'api.semanticscholar.org', body: { total: 0 } }]);
  await assert.rejects(
    semanticScholar({ fetch, env: {}, version: '0.3.0' }).search('x', {}),
    (err) => {
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /semantic-scholar/);
      return true;
    },
  );
});

test('pubmed: an empty idlist returns [] without calling esummary', async () => {
  const fetch = fakeFetch([
    { match: 'esearch.fcgi', body: fx('pubmed/esearch-empty.json') },
    { match: 'esummary.fcgi', body: fx('pubmed/esummary.json') },
  ]);
  const results = await pubmed({ fetch, env: {}, version: '0.3.0' }).search('nothing at all', {
    limit: 3,
  });
  assert.deepEqual(results, []);
  assert.equal(fetch.calls.length, 1, 'esummary is never called for an empty idlist');
});

test('pubmed: preserves the esearch relevance order rather than the esummary key order', async () => {
  const fetch = fakeFetch([
    { match: 'esearch.fcgi', body: fx('pubmed/esearch.json') },
    { match: 'esummary.fcgi', body: fx('pubmed/esummary.json') },
  ]);
  const results = await pubmed({ fetch, env: {}, version: '0.3.0' }).search('open science', {
    limit: 3,
  });
  // The fixture's idlist is [36000003, 36000001, 36000002], deliberately not ascending, so this
  // only passes if the mapping walks the esearch order and not Object.keys(result).
  assert.deepEqual(
    results.map((c) => c.external_id),
    ['36000003', '36000001', '36000002'],
  );
});

test('pubmed: maps a summary doc into a candidate, extracting the DOI from articleids', async () => {
  const fetch = fakeFetch([
    { match: 'esearch.fcgi', body: fx('pubmed/esearch.json') },
    { match: 'esummary.fcgi', body: fx('pubmed/esummary.json') },
  ]);
  const [first, second] = await pubmed({ fetch, env: {}, version: '0.3.0' }).search(
    'open science',
    { limit: 3 },
  );

  assert.deepEqual(first, {
    provider: 'pubmed',
    external_id: '36000003',
    title: 'Measurement Error in Survey Chapters',
    authors: ['Franklin R'],
    year: 2022,
    venue: 'Handbook of Survey Methods',
    doi: '10.1007/978-3-030-12345-6_7',
    url: 'https://pubmed.ncbi.nlm.nih.gov/36000003/',
    abstract: null,
    type: 'article',
    open_access: null,
    cited_by: null,
  });
  assert.equal(second.doi, '10.1109/iccv48922.2021.00986');
});

test('pubmed: sends mindate/maxdate/datetype only when a from year is given', async () => {
  const fetch = fakeFetch([
    { match: 'esearch.fcgi', body: fx('pubmed/esearch.json') },
    { match: 'esummary.fcgi', body: fx('pubmed/esummary.json') },
  ]);
  await pubmed({ fetch, env: {}, version: '0.3.0' }).search('open science', {
    from: 2021,
    limit: 3,
  });
  const esearchCall = fetch.calls.find((c) => c.url.includes('esearch.fcgi'));
  assert.match(esearchCall.url, /mindate=2021/);
  assert.match(esearchCall.url, /maxdate=3000/);
  assert.match(esearchCall.url, /datetype=pdat/);
});

test('pubmed: sends api_key on both calls only when PHDUDE_NCBI_API_KEY is set', async () => {
  const fetch = fakeFetch([
    { match: 'esearch.fcgi', body: fx('pubmed/esearch.json') },
    { match: 'esummary.fcgi', body: fx('pubmed/esummary.json') },
  ]);
  await pubmed({ fetch, env: { PHDUDE_NCBI_API_KEY: 'ncbi-secret' }, version: '0.3.0' }).search(
    'open science',
    { limit: 3 },
  );
  assert.ok(fetch.calls.every((c) => c.url.includes('api_key=ncbi-secret')));
});

test('pubmed: omits api_key when no key is configured', async () => {
  const fetch = fakeFetch([
    { match: 'esearch.fcgi', body: fx('pubmed/esearch.json') },
    { match: 'esummary.fcgi', body: fx('pubmed/esummary.json') },
  ]);
  await pubmed({ fetch, env: {}, version: '0.3.0' }).search('open science', { limit: 3 });
  assert.ok(fetch.calls.every((c) => !c.url.includes('api_key')));
});

test('pubmed: a response without an idlist is a VALIDATION', async () => {
  const fetch = fakeFetch([{ match: 'esearch.fcgi', body: { esearchresult: {} } }]);
  await assert.rejects(pubmed({ fetch, env: {}, version: '0.3.0' }).search('x', {}), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /pubmed/);
    return true;
  });
});

test('pubmed: a response without a result object is a VALIDATION', async () => {
  const fetch = fakeFetch([
    { match: 'esearch.fcgi', body: fx('pubmed/esearch.json') },
    { match: 'esummary.fcgi', body: { header: {} } },
  ]);
  await assert.rejects(pubmed({ fetch, env: {}, version: '0.3.0' }).search('x', {}), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /pubmed/);
    return true;
  });
});

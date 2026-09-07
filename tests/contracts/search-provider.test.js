import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchProviderContract } from '../../src/ports/search-provider.js';
import { arxiv } from '../../src/adapters/search/arxiv.js';
import { crossref } from '../../src/adapters/search/crossref.js';
import { openalex } from '../../src/adapters/search/openalex.js';
import { pubmed } from '../../src/adapters/search/pubmed.js';
import { semanticScholar } from '../../src/adapters/search/semantic-scholar.js';
import { fakeFetch } from '../support/fake-fetch.js';

const fx = (name) => readFileSync(new URL(`../fixtures/search/${name}`, import.meta.url), 'utf8');

// One recorded response per scenario, replayed by fakeFetch. `times: 1` on the 429 is what
// makes the retry land on the success route.
function scenarios(host, dir) {
  const success = fx(`${dir}/search.json`);
  return {
    fakeFetch,
    success: { routes: [{ match: host, body: success }], expectMinResults: 3 },
    empty: { routes: [{ match: host, body: fx(`${dir}/empty.json`) }] },
    rateLimited: {
      routes: [
        { match: host, status: 429, headers: { 'retry-after': '0' }, body: '', times: 1 },
        { match: host, body: success },
      ],
    },
    serverError: { routes: [{ match: host, status: 500, body: 'upstream is unwell' }] },
    malformed: { routes: [{ match: host, body: fx(`${dir}/malformed.txt`) }] },
  };
}

const openalexFixtures = scenarios('api.openalex.org', 'openalex');
openalexFixtures.success.expectFromInUrl = 'from_publication_date:2021-01-01';

const crossrefFixtures = scenarios('api.crossref.org', 'crossref');
crossrefFixtures.success.expectFromInUrl = 'from-pub-date:2021';

searchProviderContract(
  test,
  assert,
  ({ fetch, env }) => openalex({ fetch, env, version: '0.3.0' }),
  openalexFixtures,
);

searchProviderContract(
  test,
  assert,
  ({ fetch, env }) => crossref({ fetch, env, version: '0.3.0' }),
  crossrefFixtures,
);

// arXiv serves Atom XML, not JSON, and has no server-side date filter, so it gets its own
// fixture builder rather than `scenarios()`: the contract checks the filtered *results* via the
// provider's `filtersDateClientSide` flag rather than the request URL.
function arxivScenarios() {
  const success = fx('arxiv/search.xml');
  return {
    fakeFetch,
    success: { routes: [{ match: 'export.arxiv.org', body: success }], expectMinResults: 3 },
    empty: { routes: [{ match: 'export.arxiv.org', body: fx('arxiv/empty.xml') }] },
    rateLimited: {
      routes: [
        {
          match: 'export.arxiv.org',
          status: 429,
          headers: { 'retry-after': '0' },
          body: '',
          times: 1,
        },
        { match: 'export.arxiv.org', body: success },
      ],
    },
    serverError: {
      routes: [{ match: 'export.arxiv.org', status: 500, body: 'upstream is unwell' }],
    },
    malformed: { routes: [{ match: 'export.arxiv.org', body: fx('arxiv/malformed.txt') }] },
  };
}

searchProviderContract(
  test,
  assert,
  ({ fetch }) => arxiv({ fetch, version: '0.3.0' }),
  arxivScenarios(),
);

const s2Fixtures = scenarios('api.semanticscholar.org', 'semantic-scholar');
s2Fixtures.success.expectFromInUrl = 'year=2021-';

searchProviderContract(
  test,
  assert,
  ({ fetch, env }) => semanticScholar({ fetch, env, version: '0.3.0' }),
  s2Fixtures,
);

// PubMed is a two-step provider (esearch then esummary), so its routes match on endpoint
// rather than host alone.
function pubmedScenarios() {
  const idsBody = fx('pubmed/esearch.json');
  const summaryBody = fx('pubmed/esummary.json');
  return {
    fakeFetch,
    success: {
      routes: [
        { match: 'esearch.fcgi', body: idsBody },
        { match: 'esummary.fcgi', body: summaryBody },
      ],
      expectMinResults: 3,
      expectFromInUrl: 'mindate=2021',
    },
    empty: { routes: [{ match: 'esearch.fcgi', body: fx('pubmed/esearch-empty.json') }] },
    rateLimited: {
      routes: [
        {
          match: 'esearch.fcgi',
          status: 429,
          headers: { 'retry-after': '0' },
          body: '',
          times: 1,
        },
        { match: 'esearch.fcgi', body: idsBody },
        { match: 'esummary.fcgi', body: summaryBody },
      ],
    },
    serverError: { routes: [{ match: 'esearch.fcgi', status: 500, body: 'upstream is unwell' }] },
    malformed: { routes: [{ match: 'esearch.fcgi', body: fx('pubmed/malformed.txt') }] },
  };
}

searchProviderContract(
  test,
  assert,
  ({ fetch, env }) => pubmed({ fetch, env, version: '0.3.0' }),
  pubmedScenarios(),
);

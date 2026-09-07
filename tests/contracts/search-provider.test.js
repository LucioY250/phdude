import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchProviderContract } from '../../src/ports/search-provider.js';
import { crossref } from '../../src/adapters/search/crossref.js';
import { openalex } from '../../src/adapters/search/openalex.js';
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

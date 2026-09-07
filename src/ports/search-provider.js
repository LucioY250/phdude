/**
 * One normalized literature hit. Every provider maps its own response into exactly this shape,
 * so the domain never sees a provider's vocabulary.
 * @typedef {object} Candidate
 * @property {string} provider - the provider name that returned it
 * @property {string} external_id - the provider's own id for the work
 * @property {string} title
 * @property {string[]} authors
 * @property {number|null} year
 * @property {string|null} venue
 * @property {string|null} doi - lowercased, without the resolver prefix
 * @property {string|null} url
 * @property {string|null} abstract
 * @property {'article'|'preprint'|'book'|'chapter'|'other'} type
 * @property {boolean|null} open_access
 * @property {number|null} cited_by
 */

/**
 * @typedef {object} SearchProvider
 * @property {string} name
 * @property {string} [requiresKey] - the environment variable holding this provider's API key
 * @property {boolean} [filtersDateClientSide] - true when the provider has no server-side date
 *   filter and applies `from` itself after fetching (see `searchProviderContract`)
 * @property {(query: string, opts: {from?: number|null, limit?: number,
 *   signal?: AbortSignal}) => Promise<Candidate[]>} search
 */

export const CANDIDATE_KEYS = [
  'provider',
  'external_id',
  'title',
  'authors',
  'year',
  'venue',
  'doi',
  'url',
  'abstract',
  'type',
  'open_access',
  'cited_by',
];

export const CANDIDATE_TYPES = ['article', 'preprint', 'book', 'chapter', 'other'];

function isNullOr(value, predicate) {
  return value === null || predicate(value);
}

/**
 * Registers the node:test cases every SearchProvider implementation must satisfy. The suite
 * never touches the network: it builds the provider's `fetch` from recorded routes, which is
 * why the caller passes its `fakeFetch` in (test support cannot be imported from `src/`).
 * @param {typeof import('node:test').test} test
 * @param {typeof import('node:assert/strict')} assert
 * @param {(deps: {fetch: Function, env: object}) => SearchProvider} makeProvider
 * @param {{fakeFetch: (routes: object[]) => Function, env?: object,
 *   success: {routes: object[], expectMinResults?: number, expectFromInUrl?: string},
 *   empty: {routes: object[]}, rateLimited: {routes: object[]},
 *   serverError: {routes: object[]}, malformed: {routes: object[]}}} fixtures
 */
export function searchProviderContract(test, assert, makeProvider, fixtures) {
  const { fakeFetch, env = {} } = fixtures;
  const build = (routes) => {
    const fetch = fakeFetch(routes);
    return { fetch, provider: makeProvider({ fetch, env }) };
  };
  const probe = makeProvider({
    fetch: () => {
      throw new Error('the contract suite never calls the network');
    },
    env,
  });
  const name = probe.name;

  test(`${name}: a successful response maps into well-shaped candidates`, async () => {
    const { provider } = build(fixtures.success.routes);
    const results = await provider.search('open science', { limit: 3 });

    assert.ok(Array.isArray(results), 'search resolves to an array');
    assert.ok(
      results.length >= (fixtures.success.expectMinResults ?? 1),
      `expected at least ${fixtures.success.expectMinResults ?? 1} candidates, got ${results.length}`,
    );
    assert.ok(results.length <= 3, 'a provider never returns more than the requested limit');

    for (const candidate of results) {
      assert.deepEqual(
        Object.keys(candidate).sort(),
        [...CANDIDATE_KEYS].sort(),
        'a candidate carries exactly the Candidate keys',
      );
      assert.equal(candidate.provider, name);
      assert.equal(typeof candidate.external_id, 'string');
      assert.ok(candidate.external_id.length > 0, 'external_id is not empty');
      assert.equal(typeof candidate.title, 'string');
      assert.ok(candidate.title.trim().length > 0, 'title is not empty');
      assert.ok(Array.isArray(candidate.authors), 'authors is an array');
      for (const author of candidate.authors) assert.equal(typeof author, 'string');
      assert.ok(
        isNullOr(candidate.year, (y) => Number.isInteger(y)),
        `year is an integer or null, got ${candidate.year}`,
      );
      assert.ok(isNullOr(candidate.venue, (v) => typeof v === 'string'));
      assert.ok(
        isNullOr(
          candidate.doi,
          (d) => typeof d === 'string' && /^10\./.test(d) && d === d.toLowerCase(),
        ),
        `doi is null or a lowercase bare DOI, got ${candidate.doi}`,
      );
      assert.ok(isNullOr(candidate.url, (u) => typeof u === 'string'));
      assert.ok(isNullOr(candidate.abstract, (a) => typeof a === 'string'));
      assert.ok(CANDIDATE_TYPES.includes(candidate.type), `unknown type ${candidate.type}`);
      assert.ok(isNullOr(candidate.open_access, (o) => typeof o === 'boolean'));
      assert.ok(isNullOr(candidate.cited_by, (c) => Number.isInteger(c) && c >= 0));
    }
  });

  test(`${name}: honours a smaller limit`, async () => {
    const { provider } = build(fixtures.success.routes);
    const results = await provider.search('open science', { limit: 1 });
    assert.ok(results.length <= 1, `expected at most 1 candidate, got ${results.length}`);
  });

  if (fixtures.success.expectFromInUrl || probe.filtersDateClientSide) {
    test(`${name}: honours the from filter`, async () => {
      const { fetch, provider } = build(fixtures.success.routes);
      const results = await provider.search('open science', { from: 2021, limit: 3 });
      if (provider.filtersDateClientSide) {
        // No server-side date filter to forward: the provider filters its own response, so the
        // contract checks the results instead of the request URL.
        assert.ok(results.length > 0, 'the client-side filter still returns results');
        for (const candidate of results) {
          assert.ok(
            candidate.year === null || candidate.year >= 2021,
            `expected every candidate at or after 2021, got ${candidate.year}`,
          );
        }
      } else {
        const urls = fetch.calls.map((c) => c.url);
        assert.ok(
          urls.some((u) => decodeURIComponent(u).includes(fixtures.success.expectFromInUrl)),
          `no request carried ${fixtures.success.expectFromInUrl}: ${urls.join(' ')}`,
        );
      }
    });
  }

  test(`${name}: an empty result set is an empty array`, async () => {
    const { provider } = build(fixtures.empty.routes);
    assert.deepEqual(await provider.search('nothing at all', { limit: 3 }), []);
  });

  test(`${name}: retries once after 429 and then succeeds`, async () => {
    const { fetch, provider } = build(fixtures.rateLimited.routes);
    const results = await provider.search('open science', { limit: 3 });
    assert.ok(results.length > 0, 'the retry returns the successful response');
    // A single-request provider makes exactly two calls, both to the same URL; a multi-step
    // provider (e.g. an esearch/esummary pair) makes more, but exactly one of its URLs should
    // have been retried.
    const callsPerUrl = new Map();
    for (const call of fetch.calls) callsPerUrl.set(call.url, (callsPerUrl.get(call.url) ?? 0) + 1);
    assert.ok(
      [...callsPerUrl.values()].some((count) => count === 2),
      `expected exactly one retried request, got ${JSON.stringify([...callsPerUrl.entries()])}`,
    );
  });

  test(`${name}: a server error becomes a typed error naming the provider`, async () => {
    const { provider } = build(fixtures.serverError.routes);
    await assert.rejects(provider.search('open science', { limit: 3 }), (err) => {
      assert.equal(err.name, 'PhdudeError');
      assert.equal(err.code, 'TOOL_MISSING');
      assert.match(err.message, new RegExp(name));
      return true;
    });
  });

  test(`${name}: a malformed body is a validation error`, async () => {
    const { provider } = build(fixtures.malformed.routes);
    await assert.rejects(provider.search('open science', { limit: 3 }), (err) => {
      assert.equal(err.name, 'PhdudeError');
      assert.equal(err.code, 'VALIDATION');
      return true;
    });
  });

  test(`${name}: an already-aborted signal rejects`, async () => {
    const { provider } = build(fixtures.success.routes);
    await assert.rejects(
      provider.search('open science', { limit: 3, signal: AbortSignal.abort() }),
      (err) => {
        assert.equal(err.name, 'PhdudeError');
        return true;
      },
    );
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lookupDoi } from '../../../src/adapters/search/crossref-doi.js';
import { fakeFetch } from '../../support/fake-fetch.js';

const fixture = (name) =>
  readFileSync(new URL(`../../fixtures/search/crossref/${name}`, import.meta.url), 'utf8');

const VERSION = '0.7.0';

function rejectsWith(promise, code, match) {
  return assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    if (match) assert.match(err.message, match);
    return true;
  });
}

test('lookupDoi: returns the title, year and retraction flag of a resolved DOI', async () => {
  const fetch = fakeFetch([{ match: 'api.crossref.org', body: fixture('doi-match.json') }]);

  const record = await lookupDoi(fetch, '10.1234/adoption', { version: VERSION });

  assert.deepEqual(record, {
    doi: '10.1234/adoption',
    title: 'Adoption of AI in small firms',
    year: 2020,
    retracted: false,
    url: 'https://doi.org/10.1234/adoption',
  });
});

test('lookupDoi: asks Crossref for that one work, and says who is asking', async () => {
  const fetch = fakeFetch([{ match: 'api.crossref.org', body: fixture('doi-match.json') }]);

  await lookupDoi(fetch, '10.1234/adoption', { version: VERSION });

  const [call] = fetch.calls;
  assert.match(call.url, /^https:\/\/api\.crossref\.org\/works\//);
  assert.ok(call.url.includes(encodeURIComponent('10.1234/adoption')));
  assert.match(call.init.headers['user-agent'], /^phdude\/0\.7\.0 /);
  assert.ok(!call.url.includes('mailto'), 'no contact was recorded, so none is sent');
});

test('lookupDoi: a recorded contact joins the polite pool', async () => {
  const fetch = fakeFetch([{ match: 'api.crossref.org', body: fixture('doi-match.json') }]);

  await lookupDoi(fetch, '10.1234/adoption', { version: VERSION, mailto: 'r@example.org' });

  assert.match(fetch.calls[0].url, /mailto=r%40example\.org/);
});

test('lookupDoi: a DOI Crossref does not know is null, not an error', async () => {
  const fetch = fakeFetch([
    { match: 'api.crossref.org', status: 404, body: 'Resource not found.' },
  ]);

  assert.equal(await lookupDoi(fetch, '10.1234/missing', { version: VERSION }), null);
});

test('lookupDoi: a retraction in update-to sets the flag', async () => {
  const fetch = fakeFetch([{ match: 'api.crossref.org', body: fixture('doi-retracted.json') }]);

  const record = await lookupDoi(fetch, '10.7777/retracted', { version: VERSION });

  assert.equal(record.retracted, true);
  assert.equal(record.year, 2021);
});

test('lookupDoi: an update that is not a retraction leaves the flag down', async () => {
  const body = JSON.parse(fixture('doi-retracted.json'));
  body.message['update-to'] = [{ type: 'correction', label: 'Correction' }];
  const fetch = fakeFetch([{ match: 'api.crossref.org', body }]);

  const record = await lookupDoi(fetch, '10.7777/retracted', { version: VERSION });

  assert.equal(record.retracted, false);
});

test('lookupDoi: a work dated only by published: falls back to it', async () => {
  const fetch = fakeFetch([
    { match: 'api.crossref.org', body: fixture('doi-published-only.json') },
  ]);

  const record = await lookupDoi(fetch, '10.4444/published-only', { version: VERSION });

  assert.equal(record.year, 2024);
});

test('lookupDoi: a work with no title or date reports nulls rather than guesses', async () => {
  const fetch = fakeFetch([{ match: 'api.crossref.org', body: { message: { DOI: '10.1/x' } } }]);

  const record = await lookupDoi(fetch, '10.1000/bare', { version: VERSION });

  assert.deepEqual(record, {
    doi: '10.1000/bare',
    title: null,
    year: null,
    retracted: false,
    url: null,
  });
});

test('lookupDoi: a body that is not JSON is the provider’s fault, and says so', async () => {
  const fetch = fakeFetch([{ match: 'api.crossref.org', body: fixture('malformed.txt') }]);

  await rejectsWith(
    lookupDoi(fetch, '10.1234/adoption', { version: VERSION }),
    'VALIDATION',
    /crossref-doi/,
  );
});

test('lookupDoi: a response with no work in it is reported, not read as an empty work', async () => {
  const fetch = fakeFetch([{ match: 'api.crossref.org', body: { status: 'ok' } }]);

  await rejectsWith(
    lookupDoi(fetch, '10.1234/adoption', { version: VERSION }),
    'VALIDATION',
    /did not carry a message/,
  );
});

test('lookupDoi: a provider outage is a tool problem, not a missing DOI', async () => {
  const fetch = fakeFetch([{ match: 'api.crossref.org', status: 500, body: 'boom' }]);

  await rejectsWith(lookupDoi(fetch, '10.1234/adoption', { version: VERSION }), 'TOOL_MISSING');
});

test('lookupDoi: what is not a DOI is never sent anywhere', async () => {
  const fetch = fakeFetch([{ match: 'api.crossref.org', body: fixture('doi-match.json') }]);

  await rejectsWith(lookupDoi(fetch, 'not a doi', { version: VERSION }), 'VALIDATION', /not a DOI/);
  assert.equal(fetch.calls.length, 0);
});

test('lookupDoi: a resolver prefix is stripped before the lookup', async () => {
  const fetch = fakeFetch([{ match: 'api.crossref.org', body: fixture('doi-match.json') }]);

  const record = await lookupDoi(fetch, 'https://doi.org/10.1234/Adoption', { version: VERSION });

  assert.equal(record.doi, '10.1234/adoption');
});

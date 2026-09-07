import test from 'node:test';
import assert from 'node:assert/strict';
import { openalex } from '../../src/adapters/search/openalex.js';
import { CANDIDATE_KEYS, CANDIDATE_TYPES } from '../../src/ports/search-provider.js';

// The one check in the suite allowed to leave the machine, and it does not run unless a
// maintainer says so: `PHDUDE_LIVE_TESTS=1 npm test`. CI never sets it, and every other test
// replays recorded routes through tests/support/fake-fetch.js (ADR 7). It exists so that a
// provider quietly changing its response shape is something a maintainer can find on purpose
// rather than something a researcher finds for us.
const skip =
  process.env.PHDUDE_LIVE_TESTS === '1'
    ? false
    : 'set PHDUDE_LIVE_TESTS=1 to run the live provider check';

test('live: OpenAlex answers a real query in the shape the port promises', { skip }, async () => {
  const provider = openalex({
    fetch: globalThis.fetch,
    env: process.env,
    version: '0.3.0',
    mailto: null,
  });

  const results = await provider.search('open science practices', { from: 2021, limit: 3 });

  assert.ok(results.length > 0, 'a live provider returned nothing for a common query');
  assert.ok(results.length <= 3, 'the requested limit is honoured');
  for (const candidate of results) {
    assert.deepEqual(Object.keys(candidate).sort(), [...CANDIDATE_KEYS].sort());
    assert.equal(candidate.provider, 'openalex');
    assert.ok(candidate.title.trim().length > 0, 'a live candidate carries a title');
    assert.ok(CANDIDATE_TYPES.includes(candidate.type), `unknown type ${candidate.type}`);
    assert.ok(candidate.year === null || candidate.year >= 2021, 'the from filter reached them');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROVIDERS,
  assertNetworkAllowed,
  networkAllowed,
  providerNames,
  researchFilters,
} from '../../../src/domain/policy.js';
import { PhdudeError } from '../../../src/domain/errors.js';

test('networkAllowed: closed by default', () => {
  assert.equal(networkAllowed(null, {}), false);
  assert.equal(networkAllowed({}, {}), false);
  assert.equal(networkAllowed({ network: {} }, {}), false);
  assert.equal(networkAllowed({ network: { enabled: false } }, {}), false);
});

test('networkAllowed: the policy opens it', () => {
  assert.equal(networkAllowed({ network: { enabled: true } }, {}), true);
});

test('networkAllowed: --allow-network opens it for one command', () => {
  assert.equal(networkAllowed(null, { allowNetwork: true }), true);
  assert.equal(networkAllowed({ network: { enabled: false } }, { allowNetwork: true }), true);
});

test('networkAllowed: only a literal true opens it', () => {
  assert.equal(networkAllowed({ network: { enabled: 'yes' } }, {}), false);
  assert.equal(networkAllowed(null, { allowNetwork: 'yes' }), false);
  assert.equal(networkAllowed(null, undefined), false);
});

test('assertNetworkAllowed: refuses with a POLICY error naming both ways in', () => {
  assert.throws(
    () => assertNetworkAllowed({}, {}),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'POLICY');
      assert.equal(err.message, 'network access is disabled');
      assert.equal(
        err.hint,
        'set network.enabled: true in .phdude/research-policy.yaml or pass --allow-network',
      );
      return true;
    },
  );
});

test('assertNetworkAllowed: passes when allowed', () => {
  assert.doesNotThrow(() => assertNetworkAllowed({ network: { enabled: true } }, {}));
  assert.doesNotThrow(() => assertNetworkAllowed(null, { allowNetwork: true }));
});

test('providerNames: falls back to the default list', () => {
  assert.deepEqual(providerNames(null), DEFAULT_PROVIDERS);
  assert.deepEqual(providerNames({}), DEFAULT_PROVIDERS);
  assert.deepEqual(providerNames({ providers: [] }), DEFAULT_PROVIDERS);
  assert.deepEqual(providerNames({ providers: 'openalex' }), DEFAULT_PROVIDERS);
});

test('providerNames: keeps the policy order, normalized and deduplicated', () => {
  assert.deepEqual(providerNames({ providers: [' Crossref ', 'openalex', 'crossref'] }), [
    'crossref',
    'openalex',
  ]);
});

test('providerNames: ignores entries that are not names', () => {
  assert.deepEqual(providerNames({ providers: [null, 3, '', 'arxiv'] }), ['arxiv']);
});

test('providerNames: returns a fresh array the caller cannot mutate into the default', () => {
  const names = providerNames(null);
  names.push('pubmed');
  assert.deepEqual(providerNames(null), DEFAULT_PROVIDERS);
});

test('researchFilters: defaults when the policy says nothing', () => {
  assert.deepEqual(researchFilters(null), {
    from: null,
    languages: ['en'],
    peerReviewed: 'preferred',
    preprintsRequireApproval: true,
    limit: 20,
    staleAfterDays: 180,
  });
});

test('researchFilters: reads the policy', () => {
  const policy = {
    research: {
      year_range: { from: 2019 },
      languages: ['en', 'es'],
      peer_reviewed: 'required',
      preprints: { require_approval: false },
      freshness: { stale_after_days: 90 },
      limit: 5,
    },
  };
  assert.deepEqual(researchFilters(policy), {
    from: 2019,
    languages: ['en', 'es'],
    peerReviewed: 'required',
    preprintsRequireApproval: false,
    limit: 5,
    staleAfterDays: 90,
  });
});

test('researchFilters: rejects unusable values rather than passing them on', () => {
  const policy = {
    research: {
      year_range: { from: 'recently' },
      languages: 'en',
      peer_reviewed: 'sometimes',
      limit: 0,
      freshness: { stale_after_days: -1 },
    },
  };
  assert.deepEqual(researchFilters(policy), {
    from: null,
    languages: ['en'],
    peerReviewed: 'preferred',
    preprintsRequireApproval: true,
    limit: 20,
    staleAfterDays: 180,
  });
});

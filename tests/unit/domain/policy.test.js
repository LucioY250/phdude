import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROVIDERS,
  assertExecutionAllowed,
  assertNetworkAllowed,
  executionAllowed,
  executionTimeoutMs,
  networkAllowed,
  providerNames,
  researchFilters,
  runtimeCommand,
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

test('executionAllowed: closed by default', () => {
  assert.equal(executionAllowed(null, {}), false);
  assert.equal(executionAllowed({}, {}), false);
  assert.equal(executionAllowed({ execution: {} }, {}), false);
  assert.equal(executionAllowed({ execution: { enabled: false } }, {}), false);
});

test('executionAllowed: the policy opens it', () => {
  assert.equal(executionAllowed({ execution: { enabled: true } }, {}), true);
});

test('executionAllowed: --allow-exec opens it for one command', () => {
  assert.equal(executionAllowed(null, { allowExec: true }), true);
  assert.equal(executionAllowed({ execution: { enabled: false } }, { allowExec: true }), true);
});

test('executionAllowed: only a literal true opens it', () => {
  assert.equal(executionAllowed({ execution: { enabled: 'yes' } }, {}), false);
  assert.equal(executionAllowed(null, { allowExec: 'yes' }), false);
  assert.equal(executionAllowed(null, undefined), false);
});

test('executionAllowed: the network switch does not open execution', () => {
  assert.equal(executionAllowed({ network: { enabled: true } }, {}), false);
  assert.equal(executionAllowed(null, { allowNetwork: true }), false);
});

test('assertExecutionAllowed: refuses with a POLICY error naming both ways in', () => {
  assert.throws(
    () => assertExecutionAllowed({}, {}),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'POLICY');
      assert.equal(err.message, 'script execution is disabled');
      assert.equal(
        err.hint,
        'set execution.enabled: true in .phdude/research-policy.yaml or pass --allow-exec',
      );
      return true;
    },
  );
});

test('assertExecutionAllowed: passes when allowed', () => {
  assert.doesNotThrow(() => assertExecutionAllowed({ execution: { enabled: true } }, {}));
  assert.doesNotThrow(() => assertExecutionAllowed(null, { allowExec: true }));
});

test('runtimeCommand: the three default runtimes need no policy', () => {
  for (const policy of [null, {}, { execution: {} }]) {
    assert.equal(runtimeCommand(policy, 'node'), 'node');
    assert.equal(runtimeCommand(policy, 'python3'), 'python3');
    assert.equal(runtimeCommand(policy, 'Rscript'), 'Rscript');
  }
});

test('runtimeCommand: the policy names the executable, and may add a runtime of its own', () => {
  const policy = {
    execution: { runtimes: { python3: '/opt/venv/bin/python', julia: ' julia ' } },
  };
  assert.equal(runtimeCommand(policy, 'python3'), '/opt/venv/bin/python');
  assert.equal(runtimeCommand(policy, 'julia'), 'julia');
  assert.equal(runtimeCommand(policy, 'node'), 'node');
});

test('runtimeCommand: an unknown runtime is a VALIDATION error listing the known ones', () => {
  assert.throws(
    () => runtimeCommand({ execution: { runtimes: { julia: 'julia' } } }, 'matlab'),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      assert.equal(err.message, 'unknown runtime: matlab');
      assert.match(err.hint, /execution\.runtimes/);
      assert.match(err.hint, /julia, node, python3, Rscript/);
      return true;
    },
  );
});

test('runtimeCommand: a runtime configured with something that is not a command is unknown', () => {
  for (const value of [null, 42, '', '   ']) {
    assert.throws(() => runtimeCommand({ execution: { runtimes: { node: value } } }, 'node'), {
      code: 'VALIDATION',
      message: 'unknown runtime: node',
    });
  }
});

test('runtimeCommand: a runtimes value that is not a map falls back to the defaults', () => {
  assert.equal(runtimeCommand({ execution: { runtimes: 'node' } }, 'node'), 'node');
  assert.equal(runtimeCommand({ execution: { runtimes: ['node'] } }, 'node'), 'node');
});

test('executionTimeoutMs: ten minutes unless the policy says otherwise', () => {
  assert.equal(executionTimeoutMs(null), 600_000);
  assert.equal(executionTimeoutMs({}), 600_000);
  assert.equal(executionTimeoutMs({ execution: {} }), 600_000);
  assert.equal(executionTimeoutMs({ execution: { timeout_seconds: 30 } }), 30_000);
});

test('executionTimeoutMs: an unusable timeout falls back to the default', () => {
  for (const value of [0, -1, 'soon', 1.5, null]) {
    assert.equal(executionTimeoutMs({ execution: { timeout_seconds: value } }), 600_000);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { doctor } from '../../../src/application/doctor.js';
import { DEFAULT_PROVIDERS } from '../../../src/domain/policy.js';

const POLICY_PATH = join('.phdude', 'research-policy.yaml');

function depsWith(policy, { readYaml } = {}) {
  return {
    store: {
      root: '/nonexistent-phdude-workspace',
      exists: async () => false,
      readProject: async () => ({}),
      listCacheEntries: async () => [],
      readYaml: readYaml ?? (async (path) => (path === POLICY_PATH ? policy : null)),
    },
    git: { isAvailable: async () => true },
    parsers: [],
    loadPacks: async () => [],
    schemaTypes: [],
    node: 'v22.0.0',
    discoverSkills: async () => [],
    skillsDir: '/nonexistent-skills',
  };
}

test('doctor: a workspace without a policy reports the closed default', async () => {
  const report = await doctor(depsWith(null));
  assert.equal(report.network, false);
  assert.deepEqual(report.providers, DEFAULT_PROVIDERS);
});

test('doctor: reports the policy network setting and provider list', async () => {
  const report = await doctor(
    depsWith({ network: { enabled: true }, providers: ['openalex', 'crossref'] }),
  );
  assert.equal(report.network, true);
  assert.deepEqual(report.providers, ['openalex', 'crossref']);
});

test('doctor: an unreadable policy is reported as unreadable, never as the defaults', async () => {
  const report = await doctor(
    depsWith(null, {
      readYaml: async (path) => {
        if (path === POLICY_PATH) throw new Error('malformed YAML: .phdude/research-policy.yaml');
        return null;
      },
    }),
  );
  // What the policy says is exactly the question doctor exists to answer, so a file it cannot
  // parse must not be answered with the built-in defaults.
  assert.equal(report.policyError, 'malformed YAML: .phdude/research-policy.yaml');
  assert.equal(report.network, null);
  assert.deepEqual(report.providers, []);
  assert.ok(
    report.warnings.some((w) =>
      w.includes('research-policy.yaml could not be read: malformed YAML'),
    ),
  );
});

test('doctor: a policy it can read carries no policy error', async () => {
  const report = await doctor(depsWith({ providers: ['openalex'] }));
  assert.equal(report.policyError, null);
  assert.deepEqual(report.providers, ['openalex']);
  assert.notDeepEqual(report.providers, DEFAULT_PROVIDERS);
});

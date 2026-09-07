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

test('doctor: an unreadable policy is a warning, not a crash', async () => {
  const report = await doctor(
    depsWith(null, {
      readYaml: async (path) => {
        if (path === POLICY_PATH) throw new Error('bad yaml');
        return null;
      },
    }),
  );
  assert.equal(report.network, false);
  assert.deepEqual(report.providers, DEFAULT_PROVIDERS);
  assert.ok(
    report.warnings.some((w) => w.includes('research-policy.yaml could not be read: bad yaml')),
  );
});

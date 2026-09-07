import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { doctor } from '../../../src/application/doctor.js';
import { renderSectionFile, sectionHash } from '../../../src/domain/manuscript.js';
import { DEFAULT_PROVIDERS } from '../../../src/domain/policy.js';

const POLICY_PATH = join('.phdude', 'research-policy.yaml');

function depsWith(policy, { readYaml } = {}) {
  return {
    store: {
      root: '/nonexistent-phdude-workspace',
      exists: async () => false,
      readProject: async () => ({}),
      listCacheEntries: async () => [],
      readManuscript: async () => null,
      readSection: async () => null,
      listReports: async () => [],
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

test('doctor: a workspace with no manuscript reports no manuscript block', async () => {
  const report = await doctor(depsWith(null));
  assert.equal(report.manuscript, null);
});

test('doctor: reports sections by status, the reports on file, and a section edited by hand', async () => {
  const deps = depsWith(null);
  const recorded = 'The introduction, exactly as PhDude last wrote it.';
  const edited = 'The methods, as PhDude wrote them.';
  deps.store.readManuscript = async () => ({
    sections: [
      { id: 'abstract', file: 'manuscript/abstract.md', status: 'planned', hash: null },
      {
        id: 'introduction',
        file: 'manuscript/introduction.md',
        status: 'approved',
        hash: sectionHash(recorded),
      },
      {
        id: 'methods',
        file: 'manuscript/methods.md',
        status: 'draft',
        hash: sectionHash(edited),
      },
    ],
  });
  deps.store.readSection = async (file) =>
    file === 'manuscript/introduction.md'
      ? renderSectionFile({ section: 'introduction' }, recorded)
      : renderSectionFile({ section: 'methods' }, `${edited}\n\nA line added by hand.`);
  deps.store.listReports = async () => [{ section: 'introduction' }];

  const report = await doctor(deps);
  assert.deepEqual(report.manuscript.counts, { planned: 1, draft: 1, revised: 0, approved: 1 });
  assert.deepEqual(report.manuscript.reports, ['introduction']);
  assert.deepEqual(report.manuscript.drifted, ['methods']);
  assert.ok(
    report.warnings.includes('section methods was edited outside PhDude since its last submit'),
    report.warnings.join(' | '),
  );
});

test('doctor: a manuscript it cannot read is a warning, never the end of the report', async () => {
  const deps = depsWith(null);
  deps.store.readManuscript = async () => {
    throw new Error('malformed YAML: manuscript.yaml');
  };

  const report = await doctor(deps);
  assert.equal(report.manuscript, null);
  assert.ok(
    report.warnings.some((w) => w.includes('the manuscript could not be read: malformed YAML')),
  );
  assert.equal(report.node, 'v22.0.0');
});

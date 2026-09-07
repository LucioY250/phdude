import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceGate } from '../../../../src/domain/gates/voice.js';
import { runGates } from '../../../../src/domain/gates/index.js';

// A learned baseline of short, plain, third-person sentences with varied openings.
const LEARNED = {
  sentence_length_mean: 12,
  sentence_length_sd: 4,
  opening_diversity: 0.9,
  transition_rate: 0.1,
  first_person_rate: 0.1,
  hedge_rate: 0.1,
  paragraph_density: 3,
  preserved_terms: ['recruitment'],
  sample_count: 2,
};

function profile(overrides = {}) {
  return {
    schema: 'phdude.author-profile',
    version: 1,
    id: 'researcher-a',
    language: 'en',
    tone: { academic: true, assertiveness: 'moderate', first_person: 'sparing' },
    sentences: { length: 'varied', openings: 'varied' },
    paragraphs: { density: 'medium' },
    transitions: 'minimal',
    terminology: { preserve: [], avoid: [] },
    samples: [],
    learned: LEARNED,
    ...overrides,
  };
}

const BASE = { lang: 'en', claimsById: new Map() };

// Four sentences of 8, 16, 9 and 13 words, varied openings, no transitions and no first
// person: mean 11.5 and spread 3.2, deliberately inside every band LEARNED allows.
const ON_VOICE = [
  'Adoption held steady across the three recruited cohorts.',
  'Participants drawn from the mailing list reported slightly higher daily use than the students recruited elsewhere.',
  '',
  'Stratified sampling across further campuses corroborates the original estimate.',
  'The third survey reproduces a similar rate under a rather different sampling design.',
].join('\n');

test('without a profile the gate says nothing and scores nothing', () => {
  assert.deepEqual(voiceGate.run('Any prose at all.', BASE), {
    findings: [],
    scores: { authorVoice: null },
  });
});

test('a profile that has never learned still scores null, and still checks avoid words', () => {
  const result = voiceGate.run('This is a robust and cutting-edge finding.', {
    ...BASE,
    voiceProfile: profile({
      learned: undefined,
      terminology: { preserve: [], avoid: ['robust'] },
    }),
  });
  assert.equal(result.scores.authorVoice, null);
  assert.deepEqual(
    result.findings.map((f) => [f.gate, f.severity, f.message]),
    [['gate-voice', 'warn', 'uses "robust", which the profile\'s terminology.avoid lists']],
  );
});

test("a draft written in the profile's own voice reports nothing and scores high", () => {
  const result = voiceGate.run(ON_VOICE, { ...BASE, voiceProfile: profile() });
  assert.deepEqual(result.findings, []);
  assert.ok(result.scores.authorVoice >= 75, `scored ${result.scores.authorVoice}`);
});

test('every deviation finding names the metric, the observed value, the learned value and the band', () => {
  const long = [
    'However, the adoption of mobile note-taking applications across the three independently',
    'recruited undergraduate cohorts appears remarkably consistent once the recruitment channel',
    'itself is properly taken into account by the analysis we ran.',
  ].join(' ');

  const result = voiceGate.run(long, { ...BASE, voiceProfile: profile() });
  const byMetric = Object.fromEntries(
    result.findings.map((f) => [f.message.split(' vs ')[0].replace(/ [\d.]+$/, ''), f]),
  );

  assert.ok('mean sentence length' in byMetric, JSON.stringify(result.findings));
  for (const finding of result.findings) {
    assert.equal(finding.gate, 'gate-voice');
    assert.equal(finding.severity, 'warn');
    assert.match(finding.message, / vs learned [\d.]+ ± [\d.]+$/);
    assert.equal(typeof finding.hint, 'string');
  }
  assert.equal(typeof result.scores.authorVoice, 'number');
});

test('an avoided word is located on the line it is used', () => {
  const text = 'A first line.\nA second line.\nThis result is robust.\n';
  const [finding] = voiceGate.run(text, {
    ...BASE,
    voiceProfile: profile({ terminology: { preserve: [], avoid: ['robust'] }, learned: undefined }),
  }).findings;
  assert.equal(finding.line, 3);
});

test('terminology the claims use and the draft drops is info, not a warning', () => {
  const text = 'Adoption differs by how people were signed up.\n<!-- claim: CLAIM-1111111111 -->\n';
  const ctx = {
    ...BASE,
    claimsById: new Map([
      [
        'CLAIM-1111111111',
        { id: 'CLAIM-1111111111', statement: 'Recruitment channel is associated with adoption.' },
      ],
    ]),
    voiceProfile: profile({
      learned: undefined,
      terminology: { preserve: ['recruitment channel'], avoid: [] },
    }),
  };

  const findings = voiceGate.run(text, ctx).findings;
  assert.deepEqual(
    findings.map((f) => [f.severity, f.message]),
    [
      [
        'info',
        'the claims this section asserts use "recruitment channel", which the profile preserves, and the draft does not',
      ],
    ],
  );

  // The same draft, using the researcher's own term, says nothing.
  const kept = 'Adoption differs by recruitment channel.\n<!-- claim: CLAIM-1111111111 -->\n';
  assert.deepEqual(voiceGate.run(kept, ctx).findings, []);
});

test('voice never blocks, ruthless mode included', () => {
  const ctx = {
    lang: 'en',
    sourcesById: new Map(),
    sourcesByBibkey: new Map(),
    dismissedSources: new Map(),
    claimsById: new Map(),
    evidenceById: new Map(),
    factIds: new Set(),
    resultIds: new Set(),
    voiceProfile: profile({ terminology: { preserve: [], avoid: ['robust'] } }),
  };
  const text =
    'However, this exceptionally long and unusually meandering sentence about the robust ' +
    'recruitment channel keeps going well past anything the profile ever learned.';

  const result = runGates(text, ctx, { mode: 'ruthless' });
  const voice = result.gates.find((row) => row.gate === 'gate-voice');
  assert.ok(voice.findings > 0, 'the gate had something to say');
  assert.equal(voice.blocked, false);
  assert.equal(
    result.findings.filter((f) => f.gate === 'gate-voice' && f.severity === 'block').length,
    0,
  );
});

test('runGates carries the voice score out, and null when there is no profile', () => {
  const ctx = {
    lang: 'en',
    sourcesById: new Map(),
    sourcesByBibkey: new Map(),
    dismissedSources: new Map(),
    claimsById: new Map(),
    evidenceById: new Map(),
    factIds: new Set(),
    resultIds: new Set(),
  };
  assert.equal(runGates(ON_VOICE, ctx, {}).scores.authorVoice, null);
  assert.equal(
    typeof runGates(ON_VOICE, { ...ctx, voiceProfile: profile() }, {}).scores.authorVoice,
    'number',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { learnFrom, consensus, voiceDeviation } from '../../../src/domain/voice.js';

// Two short, hand-checked writing samples. The exact numbers below were verified by hand
// against the sentence/word counts in each sample (see the module's TODO(v0.4-T4) note on the
// stopgap sentence splitter this exercises).
const SAMPLE_1 =
  `We surveyed 312 undergraduate students about their use of mobile note-taking apps. ` +
  `However, adoption varies across recruitment channels.\n\n` +
  `Our approach suggests that campus culture shapes daily habits. Moreover, stratified ` +
  `sampling improves confidence in the results.`;

const SAMPLE_2 =
  `The second survey recruited 300 participants from a campus social media group. ` +
  `Consequently, self-selection may explain lower reported use.\n\n` +
  `We believe the pattern generalizes to similar institutions. Nevertheless, further ` +
  `replication would strengthen the claim.`;

test('learnFrom: a single sample is deterministic and matches the hand-checked numbers', () => {
  const learned = learnFrom([SAMPLE_1], 'en');
  assert.deepEqual(learned, {
    sentence_length_mean: 8.75,
    sentence_length_sd: 2.165,
    opening_diversity: 1,
    transition_rate: 0.5,
    first_person_rate: 0.057,
    hedge_rate: 0.029,
    paragraph_density: 2,
    preserved_terms: [
      'adoption',
      'approach',
      'campus',
      'channels',
      'confidence',
      'culture',
      'habits',
      'improves',
      'mobile',
      'recruitment',
      'results',
      'sampling',
      'shapes',
      'stratified',
      'students',
    ],
    sample_count: 1,
  });
});

test('learnFrom: two samples are combined into one corpus, not averaged per-sample', () => {
  const learned = learnFrom([SAMPLE_1, SAMPLE_2], 'en');
  assert.deepEqual(learned, {
    sentence_length_mean: 8.625,
    sentence_length_sd: 1.867,
    opening_diversity: 0.875,
    transition_rate: 0.5,
    first_person_rate: 0.043,
    hedge_rate: 0.029,
    paragraph_density: 2,
    preserved_terms: [
      'campus',
      'adoption',
      'approach',
      'believe',
      'channels',
      'confidence',
      'consequently',
      'culture',
      'explain',
      'generalizes',
      'habits',
      'improves',
      'institutions',
      'mobile',
      'nevertheless',
    ],
    sample_count: 2,
  });
});

test('learnFrom: preserved_terms ties break alphabetically', () => {
  // "apple" and "beach" each occur once; neither is a stopword and both are >= 6 letters once
  // punctuation-free ("apple" is 5, so use 6+ letter words instead).
  const learned = learnFrom(['Silver dollars and golden acorns. Golden acorns everywhere.'], 'en');
  // "golden" (2) and "acorns" (2) outrank the freq-1 words; within each frequency group, ties
  // break alphabetically.
  assert.deepEqual(learned.preserved_terms, [
    'acorns',
    'golden',
    'dollars',
    'everywhere',
    'silver',
  ]);
});

test('learnFrom: an empty or all-whitespace text yields zeros, not NaN or a throw', () => {
  const learned = learnFrom(['', '   \n\n  '], 'en');
  assert.deepEqual(learned, {
    sentence_length_mean: 0,
    sentence_length_sd: 0,
    opening_diversity: 0,
    transition_rate: 0,
    first_person_rate: 0,
    hedge_rate: 0,
    paragraph_density: 0,
    preserved_terms: [],
    sample_count: 0,
  });
});

function baseProfile(overrides) {
  return {
    schema: 'phdude.author-profile',
    version: 1,
    language: 'en',
    tone: { academic: true, assertiveness: 'moderate', first_person: 'sparing' },
    sentences: { length: 'varied', openings: 'varied' },
    paragraphs: { density: 'medium' },
    transitions: 'minimal',
    terminology: { preserve: [], avoid: [] },
    samples: [],
    ...overrides,
  };
}

test('consensus: categorical fields by mode, terminology by union/intersection, learned by median', () => {
  const profileA = baseProfile({
    id: 'a',
    terminology: { preserve: ['x', 'y'], avoid: ['leverage', 'robust'] },
    learned: {
      sentence_length_mean: 10,
      sentence_length_sd: 2,
      opening_diversity: 0.8,
      transition_rate: 0.1,
      first_person_rate: 0.02,
      hedge_rate: 0.03,
      paragraph_density: 3,
      preserved_terms: ['alpha', 'beta'],
      sample_count: 2,
      learned_at: '2026-01-01T00:00:00Z',
    },
  });
  const profileB = baseProfile({
    id: 'b',
    tone: { academic: true, assertiveness: 'high', first_person: 'natural' },
    sentences: { length: 'short', openings: 'consistent' },
    paragraphs: { density: 'low' },
    transitions: 'frequent',
    terminology: { preserve: ['y', 'z'], avoid: ['robust', 'cutting-edge'] },
    learned: {
      sentence_length_mean: 14,
      sentence_length_sd: 3,
      opening_diversity: 0.4,
      transition_rate: 0.3,
      first_person_rate: 0.08,
      hedge_rate: 0.01,
      paragraph_density: 5,
      preserved_terms: ['beta', 'gamma'],
      sample_count: 3,
      learned_at: '2026-01-02T00:00:00Z',
    },
  });
  // Never ran `learn`: contributes to the categorical mode and to terminology, not to `learned`.
  const profileC = baseProfile({
    id: 'c',
    language: 'es',
    tone: { academic: false, assertiveness: 'moderate', first_person: 'sparing' },
    terminology: { preserve: ['x'], avoid: ['robust'] },
  });

  const merged = consensus([profileA, profileB, profileC]);

  assert.equal(merged.id, 'project-consensus');
  assert.equal(merged.schema, 'phdude.author-profile');
  assert.equal(merged.language, 'en'); // 2 of 3 profiles
  assert.equal(merged.tone.academic, true);
  assert.equal(merged.tone.assertiveness, 'moderate');
  assert.equal(merged.tone.first_person, 'sparing');
  assert.equal(merged.sentences.length, 'varied');
  assert.equal(merged.paragraphs.density, 'medium');
  assert.equal(merged.transitions, 'minimal');
  assert.deepEqual(merged.terminology.preserve, ['x', 'y', 'z']);
  assert.deepEqual(merged.terminology.avoid, ['robust']); // the only word all three list
  assert.deepEqual(merged.samples, []);
  assert.deepEqual(merged.learned, {
    sentence_length_mean: 12,
    sentence_length_sd: 2.5,
    opening_diversity: 0.6,
    transition_rate: 0.2,
    first_person_rate: 0.05,
    hedge_rate: 0.02,
    paragraph_density: 4,
    sample_count: 2.5,
    preserved_terms: ['alpha', 'beta', 'gamma'],
  });
  assert.equal('learned_at' in merged.learned, false);
});

test('consensus: a tied categorical field resolves to the first profile listed', () => {
  const first = baseProfile({
    id: 'first',
    tone: { academic: true, assertiveness: 'moderate', first_person: 'sparing' },
  });
  const second = baseProfile({
    id: 'second',
    language: 'es',
    tone: { academic: false, assertiveness: 'high', first_person: 'natural' },
    transitions: 'frequent',
  });

  const mergedFirstFirst = consensus([first, second]);
  assert.equal(mergedFirstFirst.language, 'en');
  assert.equal(mergedFirstFirst.tone.assertiveness, 'moderate');
  assert.equal(mergedFirstFirst.transitions, 'minimal');

  const mergedSecondFirst = consensus([second, first]);
  assert.equal(mergedSecondFirst.language, 'es');
  assert.equal(mergedSecondFirst.tone.assertiveness, 'high');
  assert.equal(mergedSecondFirst.transitions, 'frequent');
});

test('consensus: no participating profile has learned data -> merged profile has none either', () => {
  const merged = consensus([baseProfile({ id: 'a' }), baseProfile({ id: 'b' })]);
  assert.equal('learned' in merged, false);
});

test('voiceDeviation: relative tolerance for sentence length, absolute for rates', () => {
  const stats = {
    sentence_length_mean: 20,
    transition_rate: 0.5,
    first_person_rate: 0.3,
    opening_diversity: 0.1,
    text: 'this leverages a robust cutting-edge approach',
  };
  const profile = {
    learned: {
      sentence_length_mean: 10,
      transition_rate: 0.1,
      first_person_rate: 0.02,
      opening_diversity: 0.8,
    },
    terminology: { avoid: ['leverage', 'robust', 'cutting-edge', 'agile'] },
  };

  const findings = voiceDeviation(stats, profile);
  const byKind = Object.fromEntries(findings.map((f) => [f.kind, f]));

  assert.equal(byKind['sentence-length'].deviation, 1); // (20-10)/10
  assert.equal(byKind['transition-rate'].deviation, 0.4);
  assert.equal(byKind['first-person-rate'].deviation, 0.28);
  assert.equal(byKind['opening-diversity'].deviation, 0.7);
  // "leverages" does not exactly match the avoided word "leverage" (whole-word match only);
  // "agile" never appears in the text; "robust" and "cutting-edge" do.
  const avoidWords = findings.filter((f) => f.kind === 'avoid-word').map((f) => f.word);
  assert.deepEqual(avoidWords.sort(), ['cutting-edge', 'robust']);
});

test('voiceDeviation: within tolerance, and no avoid words used, reports nothing', () => {
  const stats = {
    sentence_length_mean: 11,
    transition_rate: 0.12,
    first_person_rate: 0.03,
    opening_diversity: 0.75,
    text: 'a plain sentence with no forbidden terminology at all',
  };
  const profile = {
    learned: {
      sentence_length_mean: 10,
      transition_rate: 0.1,
      first_person_rate: 0.02,
      opening_diversity: 0.8,
    },
    terminology: { avoid: ['leverage'] },
  };
  assert.deepEqual(voiceDeviation(stats, profile), []);
});

test('voiceDeviation: a profile with no learned data still checks avoid words', () => {
  const findings = voiceDeviation(
    { text: 'this is quite robust' },
    { terminology: { avoid: ['robust'] } },
  );
  assert.deepEqual(findings, [
    {
      kind: 'avoid-word',
      why: 'uses "robust", which the profile\'s terminology.avoid lists',
      word: 'robust',
    },
  ]);
});

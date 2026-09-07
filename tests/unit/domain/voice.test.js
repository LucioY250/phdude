import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TOLERANCES,
  consensus,
  learnFrom,
  voiceDeviation,
  voiceScore,
} from '../../../src/domain/voice.js';

// Two short, hand-checked writing samples. The exact numbers below were verified by hand
// against the sentences `textstats` finds in each sample: SAMPLE_1 is four sentences of 12, 6,
// 9 and 8 words over two paragraphs. The rates are per sentence, not per token, because that
// is what `textstats.stats` measures and every feature reads its statistics from there.
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
    // 35 words over 4 sentences; the two sentences opening "However," and "Moreover," are the
    // transitions, "We surveyed" and "Our approach" carry the first person, "suggests" hedges.
    sentence_length_mean: 8.75,
    sentence_length_sd: 2.17,
    opening_diversity: 1,
    transition_rate: 0.5,
    first_person_rate: 0.5,
    hedge_rate: 0.25,
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
      'note-taking',
      'recruitment',
      'results',
      'sampling',
      'shapes',
      'stratified',
    ],
    sample_count: 1,
  });
});

test('learnFrom: two samples are combined into one corpus, not averaged per-sample', () => {
  const learned = learnFrom([SAMPLE_1, SAMPLE_2], 'en');
  assert.deepEqual(learned, {
    // 8 sentences over 4 paragraphs; 4 open with a transition, 3 use the first person
    // ("We surveyed", "Our approach", "We believe"), 2 hedge ("suggests", "may explain").
    sentence_length_mean: 8.63,
    sentence_length_sd: 2.12,
    opening_diversity: 1,
    transition_rate: 0.5,
    first_person_rate: 0.375,
    hedge_rate: 0.25,
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

test('voiceDeviation: relative band for sentence length, absolute for the rates', () => {
  const stats = {
    meanLen: 20,
    sdLen: 6,
    openingDiversity: 0.1,
    transitionRate: 0.5,
    firstPersonRate: 0.3,
    text: 'this leverages a robust cutting-edge approach',
  };
  const profile = {
    learned: {
      sentence_length_mean: 10,
      sentence_length_sd: 5,
      opening_diversity: 0.8,
      transition_rate: 0.1,
      first_person_rate: 0.02,
    },
    terminology: { avoid: ['leverage', 'robust', 'cutting-edge', 'agile'] },
  };

  const findings = voiceDeviation(stats, profile);
  const byKind = Object.fromEntries(findings.map((f) => [f.kind, f]));

  // Sentence length: 10 words away from a learned 10, against a band of 25% of 10.
  assert.equal(byKind['sentence-length'].deviation, 10);
  assert.equal(byKind['sentence-length'].tolerance, 2.5);
  assert.equal(byKind['sentence-length'].why, 'mean sentence length 20 vs learned 10 ± 2.5');
  assert.equal(byKind['opening-diversity'].deviation, 0.7);
  assert.equal(byKind['opening-diversity'].tolerance, 0.15);
  assert.equal(byKind['transition-rate'].deviation, 0.4);
  assert.equal(byKind['transition-rate'].tolerance, 0.1);
  assert.equal(byKind['first-person-rate'].deviation, 0.28);
  assert.equal(byKind['first-person-rate'].tolerance, 0.1);
  // The spread is 6 against a learned 5, inside a band of 50% of 5: no finding.
  assert.equal('sentence-length-sd' in byKind, false);

  // "leverages" does not exactly match the avoided word "leverage" (whole-word match only);
  // "agile" never appears in the text; "robust" and "cutting-edge" do.
  const avoidWords = findings.filter((f) => f.kind === 'avoid-word').map((f) => f.word);
  assert.deepEqual(avoidWords.sort(), ['cutting-edge', 'robust']);
});

test('voiceDeviation: the spread deviates on its own, and says by how much', () => {
  const findings = voiceDeviation(
    { meanLen: 10, sdLen: 12 },
    { learned: { sentence_length_mean: 10, sentence_length_sd: 4 } },
  );
  assert.deepEqual(
    findings.map((f) => [f.kind, f.why]),
    [['sentence-length-sd', 'sentence length spread 12 vs learned 4 ± 2']],
  );
});

test('voiceDeviation: within tolerance, and no avoid words used, reports nothing', () => {
  const stats = {
    meanLen: 11,
    sdLen: 5,
    openingDiversity: 0.75,
    transitionRate: 0.12,
    firstPersonRate: 0.03,
    text: 'a plain sentence with no forbidden terminology at all',
  };
  const profile = {
    learned: {
      sentence_length_mean: 10,
      sentence_length_sd: 5,
      opening_diversity: 0.8,
      transition_rate: 0.1,
      first_person_rate: 0.02,
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
      index: 14,
    },
  ]);
});

test('voiceDeviation: a learned value of zero is not comparable, so it never deviates', () => {
  const findings = voiceDeviation(
    { meanLen: 24, sdLen: 8, transitionRate: 0.4 },
    { learned: { sentence_length_mean: 0, sentence_length_sd: 0, transition_rate: 0 } },
  );
  assert.deepEqual(
    findings.map((f) => f.kind),
    ['transition-rate'],
  );
});

test('voiceScore: a draft on every tolerance edge scores 75, and a matching draft 100', () => {
  const learned = {
    sentence_length_mean: 20,
    sentence_length_sd: 4,
    opening_diversity: 0.8,
    transition_rate: 0.1,
    first_person_rate: 0.02,
  };
  const identical = {
    meanLen: 20,
    sdLen: 4,
    openingDiversity: 0.8,
    transitionRate: 0.1,
    firstPersonRate: 0.02,
  };
  assert.equal(voiceScore(identical, { learned }), 100);

  // Exactly one tolerance away on every metric: 20 ± 5, 4 ± 2, 0.8 ± 0.15, 0.1 ± 0.1, 0.02 ± 0.1.
  const atTheEdge = {
    meanLen: 25,
    sdLen: 6,
    openingDiversity: 0.65,
    transitionRate: 0.2,
    firstPersonRate: 0.12,
  };
  assert.equal(voiceScore(atTheEdge, { learned }), 75);
});

test('voiceScore: nothing comparable scores null, not zero', () => {
  assert.equal(voiceScore({ meanLen: 20 }, null), null);
  assert.equal(voiceScore({ meanLen: 20 }, { terminology: { avoid: [] } }), null);
  assert.equal(voiceScore({}, { learned: { sentence_length_mean: 20 } }), null);
});

test('voiceScore: a wildly different draft is clamped at 0, never negative', () => {
  const learned = { sentence_length_mean: 10, opening_diversity: 0.9 };
  assert.equal(voiceScore({ meanLen: 80, openingDiversity: 0.1 }, { learned }), 0);
});

test('the default tolerances are the five metrics spec §3.4 gate 4 names', () => {
  assert.deepEqual(Object.keys(DEFAULT_TOLERANCES).sort(), [
    'first_person_rate',
    'opening_diversity',
    'sentence_length',
    'sentence_length_sd',
    'transition_rate',
  ]);
});

test('every caller is judged against the same tolerance table', () => {
  const profile = { learned: { sentence_length_mean: 10 } };
  assert.deepEqual(voiceDeviation({ meanLen: 11 }, profile), []);
  assert.deepEqual(
    voiceDeviation({ meanLen: 13 }, profile).map((f) => f.kind),
    ['sentence-length'],
  );
  assert.deepEqual(
    voiceDeviation({ meanLen: 13 }, profile, { sentence_length: 5 }).map((f) => f.kind),
    ['sentence-length'],
  );
});

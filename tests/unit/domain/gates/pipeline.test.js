import test from 'node:test';
import assert from 'node:assert/strict';
import { GATES, defaultGates, runGates } from '../../../../src/domain/gates/index.js';
import { profileGate } from '../../../../src/domain/gates/profile.js';
import { proseGate } from '../../../../src/domain/gates/prose.js';
import { voiceGate } from '../../../../src/domain/gates/voice.js';

const EMPTY = {
  sourcesById: new Map(),
  sourcesByBibkey: new Map(),
  dismissedSources: new Map(),
  claimsById: new Map(),
  evidenceById: new Map(),
  factIds: new Set(),
  resultIds: new Set(),
  lang: 'en',
};

// Prose that trips two rules and nothing else: three consecutive list items opening on the same
// two words. It needs no workspace at all.
const SLOPPY = ['- Adoption is slow.', '- Adoption is uneven.', '- Adoption is costly.'].join('\n');
const SLOPPY_RULES = ['repeated-openings', 'symmetrical-lists'];

test('the registry names the six gates of spec §3.4, in reporting order', () => {
  assert.deepEqual(Object.keys(GATES), [
    'gate-citations',
    'gate-evidence',
    'gate-prose',
    'gate-voice',
    'gate-meaning',
    'gate-profile',
  ]);
  for (const [name, gate] of Object.entries(GATES)) assert.equal(gate.name, name);
});

test('gate-meaning only joins the default set when there is a revision to compare against', () => {
  assert.deepEqual(
    defaultGates().map((g) => g.name),
    ['gate-citations', 'gate-evidence', 'gate-prose', 'gate-voice', 'gate-profile'],
  );
  assert.ok(defaultGates({ revisionOf: 'old text' }).some((g) => g.name === 'gate-meaning'));
});

test('runGates reports every gate it ran, and carries the prose gate scores out', () => {
  const result = runGates('Plain prose about adoption.\n', EMPTY, {});
  assert.deepEqual(
    result.gates.map((row) => row.gate),
    ['gate-citations', 'gate-evidence', 'gate-prose', 'gate-voice', 'gate-profile'],
  );
  assert.equal(result.blocked, false);
  assert.equal(typeof result.scores.specificity, 'number');
  assert.equal(typeof result.scores.evidenceAlignment, 'number', 'markers were supplied');
});

test('the prose gate warns in full mode, blocks in ruthless, informs in lite and is silent when off', () => {
  const severity = (mode) =>
    proseGate.run(SLOPPY, { ...EMPTY, mode }).findings.map((f) => f.severity);
  assert.deepEqual(
    severity('full'),
    SLOPPY_RULES.map(() => 'warn'),
  );
  assert.deepEqual(
    severity('ruthless'),
    SLOPPY_RULES.map(() => 'block'),
  );
  assert.deepEqual(
    severity('lite'),
    SLOPPY_RULES.map(() => 'info'),
  );
  assert.deepEqual(severity('off'), []);
  assert.equal(
    typeof proseGate.run(SLOPPY, { ...EMPTY, mode: 'off' }).scores.specificity,
    'number',
  );
});

test('a ruthless prose finding blocks the whole run', () => {
  const result = runGates(SLOPPY, { ...EMPTY, mode: 'ruthless' }, { mode: 'ruthless' });
  assert.equal(result.blocked, true);
  assert.equal(result.gates.find((row) => row.gate === 'gate-prose').blocked, true);
});

test('gate-voice is silent, and scores nothing, without an author profile', () => {
  assert.deepEqual(voiceGate.run('anything', EMPTY), {
    findings: [],
    scores: { authorVoice: null },
  });
});

test('gate-profile is silent without a target profile', () => {
  assert.deepEqual(profileGate.run('any text', EMPTY), []);
});

test('gate-profile warns on a section the venue does not list, and leaves the order alone', () => {
  const venueProfile = {
    name: 'generic-thesis',
    sections: [
      { id: 'abstract', max_words: 500 },
      { id: 'introduction', max_words: 6000 },
    ],
  };

  assert.deepEqual(profileGate.run('Short.', { venueProfile, section: 'appendix' }), [
    {
      gate: 'gate-profile',
      severity: 'warn',
      line: 1,
      message: 'generic-thesis does not list a "appendix" section',
      hint: 'generic-thesis expects: abstract, introduction',
    },
  ]);

  // Where the venue puts a section is a fact about the whole manuscript, and a gate that sees one
  // section cannot tell a reordered manuscript from one that is simply missing a section.
  assert.deepEqual(profileGate.run('Short.', { venueProfile, section: 'introduction' }), []);
});

test('gate-profile blocks a section over the venue word limit', () => {
  const venueProfile = { name: 'tiny-venue', sections: [{ id: 'abstract', max_words: 5 }] };
  const findings = profileGate.run('one two three four five six seven', {
    venueProfile,
    section: 'abstract',
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'block');
  assert.match(findings[0].message, /7 words exceeds the 5-word limit/);
});

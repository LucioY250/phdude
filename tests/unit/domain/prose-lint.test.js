import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMULAS, RULES, SCORES, lint } from '../../../src/domain/prose-lint.js';
import { TABLES } from '../../../src/domain/lang/index.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'prose');
const fixture = (rel) => readFileSync(join(FIXTURES, rel), 'utf8');
const rulesIn = (report) => [...new Set(report.observations.map((o) => o.rule))].sort();

test('a clean academic paragraph produces no observations at all', () => {
  for (const lang of ['en', 'es']) {
    const report = lint(fixture(`${lang}/clean.md`), { lang });
    assert.deepEqual(report.observations, [], `${lang}/clean.md should be clean`);
  }
});

test('every lint rule fires on the fixture written for it', () => {
  const fired = {
    'en/slop.md': [
      'banned-phrase',
      'empty-phrase',
      'excessive-hedging',
      'repeated-openings',
      'sentence-monotony',
      'symmetrical-lists',
      'transition-density',
      'unsupported-intensifier',
      'vague-literature',
    ],
    'en/monotony.md': ['sentence-monotony'],
    'en/openings.md': ['repeated-openings'],
    'en/lists.md': ['symmetrical-lists'],
    'en/hedging.md': ['excessive-hedging'],
  };
  for (const [file, expected] of Object.entries(fired)) {
    assert.deepEqual(rulesIn(lint(fixture(file), { lang: 'en' })), expected, file);
  }
  // The English fixture exercises all nine rules; nothing may be left untested.
  assert.deepEqual(fired['en/slop.md'], [...RULES].sort());
});

test('the Spanish slop fixture fires the language rules against the Spanish table', () => {
  const report = lint(fixture('es/slop.md'), { lang: 'es' });
  assert.deepEqual(rulesIn(report), [
    'banned-phrase',
    'empty-phrase',
    'excessive-hedging',
    'transition-density',
    'unsupported-intensifier',
    'vague-literature',
  ]);
});

test('every observation is located, quotable and actionable', () => {
  const report = lint(fixture('en/slop.md'), { lang: 'en' });
  assert.ok(report.observations.length > 0);
  for (const o of report.observations) {
    assert.deepEqual(Object.keys(o).sort(), [
      'excerpt',
      'hint',
      'line',
      'message',
      'rule',
      'severity',
    ]);
    assert.ok(Number.isInteger(o.line) && o.line >= 1, `${o.rule}: line ${o.line}`);
    assert.ok(o.excerpt.length > 0, `${o.rule}: no excerpt`);
    assert.ok(o.message.length > 0, `${o.rule}: no message`);
    assert.ok(o.hint.length > 0, `${o.rule}: no hint`);
    assert.equal(o.severity, 'warn');
  }
});

test('observations are sorted by line, then rule, then excerpt', () => {
  const report = lint(fixture('en/slop.md'), { lang: 'en' });
  const keys = report.observations.map((o) => [o.line, o.rule, o.excerpt]);
  const sorted = [...keys].sort(
    (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || (a[2] < b[2] ? -1 : 1),
  );
  assert.deepEqual(keys, sorted);
});

test('lines point at the paragraph the observation is in', () => {
  const report = lint(fixture('en/slop.md'), { lang: 'en' });
  const lists = report.observations.find((o) => o.rule === 'symmetrical-lists');
  assert.equal(lists.line, 11, 'the list starts on line 11 of the fixture');
  const hedging = report.observations.find((o) => o.rule === 'excessive-hedging');
  assert.equal(hedging.line, 5);
});

test('unsupported-intensifier spares a sentence that cites or marks its evidence', () => {
  const cited = lint('The effect was significant in the replication [@lopez2023].', { lang: 'en' });
  assert.deepEqual(cited.observations, []);
  const marked = lint('The effect was significant. <!-- result: RESULT-1 -->', { lang: 'en' });
  assert.deepEqual(
    marked.observations.filter((o) => o.rule === 'unsupported-intensifier'),
    [],
  );
  const bare = lint('The effect was significant.', { lang: 'en' });
  assert.deepEqual(rulesIn(bare), ['unsupported-intensifier']);
});

test('vague-literature spares a sentence that names its sources', () => {
  const bare = lint('Recent studies report the same gap.', { lang: 'en' });
  assert.deepEqual(rulesIn(bare), ['vague-literature']);
  const cited = lint('Recent studies report the same gap [@lopez2023; @bell2021].', { lang: 'en' });
  assert.deepEqual(cited.observations, []);
});

test('transition-density needs three sentences before a share means anything', () => {
  const short = lint('Furthermore, the rate rose. The cohort was small.', { lang: 'en' });
  assert.equal(
    short.observations.filter((o) => o.rule === 'transition-density').length,
    0,
    'two sentences cannot establish a density',
  );
  const long = lint(
    'Furthermore, the rate rose. Moreover, it held. The cohort was small enough to check by hand.',
    { lang: 'en' },
  );
  assert.equal(long.observations.filter((o) => o.rule === 'transition-density').length, 1);
});

test('ruthless mode turns every warning into a block, and leaves info alone', () => {
  const report = lint(fixture('en/slop.md'), { lang: 'en', mode: 'ruthless' });
  assert.ok(report.observations.length > 0);
  for (const o of report.observations) assert.equal(o.severity, 'block');

  const unknown = lint('Das Ergebnis war klar.', { lang: 'de', mode: 'ruthless' });
  assert.deepEqual(
    unknown.observations.map((o) => o.severity),
    ['info'],
  );
});

test('an unknown language runs the structural rules and says so', () => {
  const report = lint(fixture('en/monotony.md'), { lang: 'de' });
  assert.deepEqual(rulesIn(report), ['sentence-monotony', 'unsupported-language']);
  const note = report.observations.find((o) => o.rule === 'unsupported-language');
  assert.equal(note.severity, 'info');
  assert.match(note.message, /^no prose resources ship for language "de"/);
  assert.equal(report.lang, 'de');
});

test('the language note names a supported language in its hint', () => {
  const note = lint('Text.', { lang: 'de' }).observations[0];
  for (const code of Object.keys(TABLES)) {
    assert.ok(note.hint.includes(code), `the hint should offer --lang ${code}`);
  }
});

test('scores are integers in 0-100, or null when their input was not supplied', () => {
  for (const file of ['en/clean.md', 'en/slop.md', 'es/slop.md']) {
    const lang = file.slice(0, 2);
    const report = lint(fixture(file), { lang });
    assert.deepEqual(Object.keys(report.scores), SCORES);
    for (const [name, value] of Object.entries(report.scores)) {
      if (value === null) continue;
      assert.ok(Number.isInteger(value), `${file}: ${name} is not an integer`);
      assert.ok(value >= 0 && value <= 100, `${file}: ${name} out of range (${value})`);
    }
    assert.ok(Number.isInteger(report.aggregate));
    assert.ok(report.aggregate >= 0 && report.aggregate <= 100);
  }
});

test('the three scores that need the evidence graph or a voice profile are null', () => {
  const report = lint(fixture('en/clean.md'), { lang: 'en' });
  assert.equal(report.scores.evidenceAlignment, null);
  assert.equal(report.scores.epistemicPrecision, null);
  assert.equal(report.scores.authorVoice, null);
  assert.deepEqual(report.inputs, { markers: false, profile: false });
});

test('clean prose scores above sloppy prose on every computed dimension', () => {
  const clean = lint(fixture('en/clean.md'), { lang: 'en' });
  const slop = lint(fixture('en/slop.md'), { lang: 'en' });
  for (const name of ['specificity', 'structuralVariation', 'conciseness']) {
    assert.ok(
      clean.scores[name] > slop.scores[name],
      `${name}: clean ${clean.scores[name]} should beat slop ${slop.scores[name]}`,
    );
  }
  assert.ok(clean.aggregate > slop.aggregate);
});

test('every score carries a documented formula', () => {
  const report = lint('Text.', { lang: 'en' });
  for (const name of [...SCORES, 'aggregate']) {
    assert.equal(typeof report.formulas[name], 'string', `${name} has no formula`);
    assert.ok(report.formulas[name].length > 10, `${name}'s formula says nothing`);
  }
  assert.deepEqual(Object.keys(report.formulas).sort(), Object.keys(FORMULAS).sort());
});

test('no formula, message or hint mentions an AI detector (PRD §30c)', () => {
  const report = lint(fixture('en/slop.md'), { lang: 'en' });
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /detect/i);
  assert.doesNotMatch(text, /humaniz/i);
});

test('empty text lints to nothing rather than throwing', () => {
  const report = lint('', { lang: 'en' });
  assert.deepEqual(report.observations, []);
  assert.equal(report.stats.sentences, 0);
  assert.equal(report.scores.specificity, 100);
});

test('the language tables keep their phrase lists disjoint', () => {
  for (const [code, table] of Object.entries(TABLES)) {
    const seen = new Map();
    for (const list of ['transitions', 'hedges', 'intensifiers', 'banned', 'empty']) {
      for (const phrase of table[list]) {
        assert.equal(phrase, phrase.toLowerCase(), `${code}.${list}: "${phrase}" is not lowercase`);
        assert.equal(
          seen.get(phrase),
          undefined,
          `${code}: "${phrase}" is in both ${seen.get(phrase)} and ${list}`,
        );
        seen.set(phrase, list);
      }
    }
    for (const pattern of table.vagueLiterature) {
      assert.doesNotThrow(() => new RegExp(pattern, 'iu'), `${code}: "${pattern}" is not a regex`);
    }
  }
});

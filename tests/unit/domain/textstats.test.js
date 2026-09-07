import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findPhrases,
  opening,
  paragraphs,
  sentenceSpans,
  splitSentences,
  startsWithTransition,
  stats,
  stripMarkup,
  words,
} from '../../../src/domain/textstats.js';
import { tableFor } from '../../../src/domain/lang/index.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'prose');
const fixture = (rel) => readFileSync(join(FIXTURES, rel), 'utf8');

test('splitSentences: a period only ends a sentence before a capital, a digit or a quote', () => {
  assert.deepEqual(splitSentences('One idea. Two ideas. Three ideas.', 'en'), [
    'One idea.',
    'Two ideas.',
    'Three ideas.',
  ]);
  assert.deepEqual(splitSentences('The value was low. it rose later.', 'en'), [
    'The value was low. it rose later.',
  ]);
  assert.deepEqual(splitSentences('He asked why. "Because it works," she said.', 'en'), [
    'He asked why.',
    '"Because it works," she said.',
  ]);
});

test('splitSentences: abbreviations from the language table never split', () => {
  assert.deepEqual(splitSentences('Mobile devices, e.g. phones, were common.', 'en'), [
    'Mobile devices, e.g. phones, were common.',
  ]);
  assert.deepEqual(splitSentences('See Fig. 2 and pp. 14 for the table.', 'en'), [
    'See Fig. 2 and pp. 14 for the table.',
  ]);
  assert.deepEqual(splitSentences('Lopez et al. reported the same effect.', 'en'), [
    'Lopez et al. reported the same effect.',
  ]);
  // `etc.` is on both language lists, so a sentence carrying one mid-thought stays whole.
  assert.deepEqual(
    splitSentences('The dataset includes surveys, interviews, etc. All were coded.', 'en'),
    ['The dataset includes surveys, interviews, etc. All were coded.'],
  );
  assert.deepEqual(splitSentences('Véase la fig. 3 del anexo.', 'es'), [
    'Véase la fig. 3 del anexo.',
  ]);
});

test('splitSentences: decimals, initials and ordered-list markers are not boundaries', () => {
  assert.deepEqual(splitSentences('The mean was 3.14 in both groups.', 'en'), [
    'The mean was 3.14 in both groups.',
  ]);
  assert.deepEqual(splitSentences('J. R. Smith collected the data.', 'en'), [
    'J. R. Smith collected the data.',
  ]);
  assert.deepEqual(splitSentences('1. Collect the forms.\n2. Enter the codes.', 'en'), [
    '1. Collect the forms.',
    '2. Enter the codes.',
  ]);
});

test('splitSentences: a bullet item opening a line ends the sentence before it', () => {
  assert.deepEqual(splitSentences('Two areas.\n- Frequency of use.\n- Depth of review.', 'en'), [
    'Two areas.',
    '- Frequency of use.',
    '- Depth of review.',
  ]);
});

test('splitSentences: Spanish question and exclamation openings start a sentence', () => {
  assert.deepEqual(splitSentences('El dato es claro. ¿Qué explica la diferencia?', 'es'), [
    'El dato es claro.',
    '¿Qué explica la diferencia?',
  ]);
});

test('splitSentences: an unknown language keeps the structural rules and loses abbreviations', () => {
  assert.deepEqual(splitSentences('Das Ergebnis war klar. Die Daten stimmen.', 'de'), [
    'Das Ergebnis war klar.',
    'Die Daten stimmen.',
  ]);
});

test('sentenceSpans: offsets point at the sentence in the original text', () => {
  const text = 'First one. Second one.';
  const spans = sentenceSpans(text, 'en');
  assert.deepEqual(
    spans.map((span) => span.index),
    [0, 11],
  );
  assert.equal(text.slice(spans[1].index, spans[1].index + spans[1].text.length), 'Second one.');
});

test('paragraphs: blank lines separate, headings and fenced code are excluded', () => {
  const parsed = paragraphs(fixture('en/structure.md'));
  assert.equal(parsed.length, 2);
  assert.deepEqual(
    parsed.map((p) => p.text),
    ['A short prose paragraph sits here.', 'Another paragraph follows the fenced block.'],
  );
  assert.deepEqual(
    parsed.map((p) => p.line),
    [8, 16],
  );
});

test('paragraphs: front matter at the top of the file is not prose', () => {
  assert.deepEqual(paragraphs('---\nsection: intro\n---\n\nBody text.'), [
    { text: 'Body text.', line: 5 },
  ]);
});

test('stripMarkup: citations, markers, code and link syntax leave the prose behind', () => {
  assert.equal(
    stripMarkup('The rate rose [@lopez2023] <!-- fact: FACT-1 --> and `code` held.'),
    'The rate rose     and   held.',
  );
  assert.equal(
    stripMarkup('See [the table](https://example.org/t) for **totals**.'),
    'See the table for totals.',
  );
});

test('words: citations do not count as words and a decimal counts as one', () => {
  assert.deepEqual(words('The mean was 3.14 [@lopez2023].'), ['The', 'mean', 'was', '3.14']);
  assert.equal(words('- Frequency of use across a typical week.').length, 7);
});

test('opening: the first two words, lowercased, ignoring the list marker', () => {
  assert.equal(opening('The model predicts adoption.'), 'the model');
  assert.equal(opening('- Provide a review of the field.'), 'provide a');
  assert.equal(opening('The model predicts adoption.', 3), 'the model predicts');
  assert.equal(opening('   '), '');
});

test('findPhrases: whole-word, case-insensitive, sorted by position', () => {
  assert.deepEqual(findPhrases('In order to act, we acted in order to learn.', ['in order to']), [
    { phrase: 'in order to', index: 0 },
    { phrase: 'in order to', index: 26 },
  ]);
  assert.deepEqual(findPhrases('Reorder to taste.', ['order to']), []);
});

test('startsWithTransition: only at the head of the sentence, quotes ignored', () => {
  const en = tableFor('en');
  assert.equal(startsWithTransition('Furthermore, the rate rose.', en), true);
  assert.equal(startsWithTransition('"However, the rate fell."', en), true);
  assert.equal(startsWithTransition('The rate rose. However, it fell.', en), false);
  assert.equal(startsWithTransition('Howevering is not a word.', en), false);
  assert.equal(startsWithTransition('Furthermore, the rate rose.', null), false);
});

test('stats: a known paragraph produces the numbers a voice profile is learned from', () => {
  const measured = stats(fixture('en/monotony.md'), 'en');
  assert.equal(measured.sentences, 6);
  assert.equal(measured.words, 48);
  assert.equal(measured.meanLen, 8);
  assert.equal(measured.sdLen, 0);
  assert.equal(measured.openingDiversity, 1);
  assert.equal(measured.transitionRate, 0);
  assert.equal(measured.paragraphDensity, 6);
  assert.equal(measured.lang, 'en');
});

test('stats: rates count the sentences that carry the pattern', () => {
  const measured = stats('We ran the study. Furthermore, it may work. The data held.', 'en');
  assert.equal(measured.sentences, 3);
  assert.equal(measured.firstPersonRate, 0.3333);
  assert.equal(measured.transitionRate, 0.3333);
  assert.equal(measured.hedgeRate, 0.3333);
  assert.equal(measured.intensifierCount, 0);
});

test('stats: Spanish text is measured against the Spanish table', () => {
  const measured = stats(fixture('es/clean.md'), 'es');
  assert.equal(measured.lang, 'es');
  assert.equal(measured.sentences, 5);
  assert.equal(measured.transitionRate, 0);
  assert.ok(measured.sdLen > 0, 'the sentences are not all the same length');
});

test('stats: an unknown language reports null rather than zero for what it cannot measure', () => {
  const measured = stats('Das Ergebnis war klar. Die Daten stimmen alle.', 'de');
  assert.equal(measured.sentences, 2);
  assert.equal(measured.lang, 'de');
  assert.equal(measured.transitionRate, null);
  assert.equal(measured.firstPersonRate, null);
  assert.equal(measured.hedgeRate, null);
  assert.equal(measured.intensifierCount, null);
  assert.ok(measured.meanLen > 0, 'the structural statistics are still computed');
});

test('stats: empty text is zeroed, not NaN', () => {
  const measured = stats('', 'en');
  assert.equal(measured.sentences, 0);
  assert.equal(measured.words, 0);
  assert.equal(measured.meanLen, 0);
  assert.equal(measured.sdLen, 0);
  assert.equal(measured.openingDiversity, 0);
  assert.equal(measured.paragraphDensity, 0);
});

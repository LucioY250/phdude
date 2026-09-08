import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TITLE_SIMILARITY_THRESHOLD,
  jaccard,
  titleSimilarity,
  titleTokens,
} from '../../../src/domain/similarity.js';

test('titleTokens: words only, lowercased, punctuation and markup dropped', () => {
  assert.deepEqual(
    [...titleTokens('Adoption of <i>AI</i>, revisited: a 2020 study!')],
    ['adoption', 'of', 'ai', 'revisited', 'a', '2020', 'study'],
  );
});

test('titleTokens: diacritics are folded, so a hand-typed title still matches', () => {
  assert.deepEqual([...titleTokens('Adopción')], [...titleTokens('Adopcion')]);
});

test('titleTokens: a repeated word counts once', () => {
  assert.equal(titleTokens('the study of the study').size, 3);
});

test('titleTokens: nothing but punctuation is no tokens at all', () => {
  assert.equal(titleTokens('—  …  —').size, 0);
  assert.equal(titleTokens('').size, 0);
  assert.equal(titleTokens(null).size, 0);
});

test('jaccard: identical sets are 1, disjoint sets are 0', () => {
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
  assert.equal(jaccard(new Set(['a']), new Set(['b'])), 0);
});

test('jaccard: shared over union', () => {
  assert.equal(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd'])), 0.5);
});

test('jaccard: an empty side scores 0 rather than dividing by zero', () => {
  assert.equal(jaccard(new Set(), new Set(['a'])), 0);
  assert.equal(jaccard(new Set(), new Set()), 0);
});

test('jaccard is symmetric', () => {
  const a = new Set(['a', 'b', 'c']);
  const b = new Set(['c', 'd']);
  assert.equal(jaccard(a, b), jaccard(b, a));
});

test('titleSimilarity: the same title with different punctuation and case is 1', () => {
  assert.equal(
    titleSimilarity('Adoption of AI in Small Firms', 'adoption of ai in small firms.'),
    1,
  );
});

test('titleSimilarity: a subtitle the registry never recorded still clears the threshold', () => {
  const score = titleSimilarity(
    'Adoption of artificial intelligence in small and medium firms',
    'Adoption of artificial intelligence in small and medium firms: a survey',
  );
  assert.ok(score >= TITLE_SIMILARITY_THRESHOLD, `expected ≥ 0.8, got ${score}`);
});

test('titleSimilarity: a different paper falls well below the threshold', () => {
  const score = titleSimilarity(
    'Adoption of AI in small firms',
    'Groundwater recharge in arid basins',
  );
  assert.ok(score < TITLE_SIMILARITY_THRESHOLD, `expected < 0.8, got ${score}`);
});

test('the threshold is the 0.8 the spec names', () => {
  assert.equal(TITLE_SIMILARITY_THRESHOLD, 0.8);
});

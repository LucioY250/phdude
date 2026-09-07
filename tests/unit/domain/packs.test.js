import test from 'node:test';
import assert from 'node:assert/strict';
import { scorePackDetection, recommendPacks } from '../../../src/domain/packs.js';

function pack(name, kind, keywords) {
  return { name, kind, detect: { keywords } };
}

const quantitative = pack('quantitative', 'method', [
  'regression',
  'p-value',
  'anova',
  'sample',
  'survey',
  'likert',
  'cronbach',
  'variance',
  'correlation',
  'significance',
]);

const qualitative = pack('qualitative', 'method', [
  'thematic analysis',
  'grounded theory',
  'saturation',
  'coding scheme',
  'triangulation',
  'reflexivity',
  'interview transcript',
  'focus group',
]);

test('scores a regression/p-value text above quantitative than qualitative', () => {
  const text = `
    We ran a linear regression and report the p-value alongside effect sizes.
    An ANOVA confirmed significance across groups, and the survey used Likert items.
    Cronbach's alpha assessed reliability; we also report variance and correlation.
  `;
  const scores = scorePackDetection([quantitative, qualitative], [text]);
  const byName = Object.fromEntries(scores.map((s) => [s.name, s]));
  assert.ok(byName.quantitative.score > (byName.qualitative?.score ?? 0));
  assert.equal(byName.quantitative.kind, 'method');
});

test('score is distinct keywords hit over total keywords, rounded to 3 decimals', () => {
  const p = pack('p', 'method', ['alpha', 'beta', 'gamma']);
  const scores = scorePackDetection([p], ['alpha appears once, and alpha again, plus beta.']);
  assert.equal(scores.length, 1);
  assert.equal(scores[0].score, 0.667);
  const hitsByKeyword = Object.fromEntries(scores[0].hits.map((h) => [h.keyword, h.count]));
  assert.equal(hitsByKeyword.alpha, 2);
  assert.equal(hitsByKeyword.beta, 1);
  assert.equal(hitsByKeyword.gamma, undefined);
});

test('only packs with score > 0 are returned, sorted by score desc then name', () => {
  const a = pack('a-pack', 'field', ['zzzalpha']);
  const b = pack('b-pack', 'field', ['zzzbeta']);
  const c = pack('c-pack', 'field', ['zzzgamma']);
  const scores = scorePackDetection([a, b, c], ['zzzbeta and zzzalpha both appear here']);
  assert.deepEqual(
    scores.map((s) => s.name),
    ['a-pack', 'b-pack'],
  );
});

test('recommendPacks filters by threshold and returns sorted names', () => {
  const scores = [
    { name: 'high', kind: 'field', score: 0.5, hits: [] },
    { name: 'low', kind: 'field', score: 0.1, hits: [] },
    { name: 'exact', kind: 'field', score: 0.25, hits: [] },
  ];
  assert.deepEqual(recommendPacks(scores, { threshold: 0.25 }), ['exact', 'high']);
  assert.deepEqual(recommendPacks(scores), ['exact', 'high']);
  assert.deepEqual(recommendPacks(scores, { threshold: 0.6 }), []);
});

test('regex metacharacters in a keyword (e.g. c++) do not throw and match whole-word', () => {
  const p = pack('cs', 'field', ['c++']);
  const scores = scorePackDetection([p], ['We wrote it in c++ today, not c#.']);
  assert.equal(scores.length, 1);
  assert.equal(scores[0].hits[0].count, 1);
});

test('whole-word matching: "test" does not match "testing"', () => {
  const p = pack('t', 'field', ['test']);
  const scores = scorePackDetection([p], ['This is testing, not a real test.']);
  assert.equal(scores.length, 1);
  assert.equal(scores[0].hits[0].count, 1);
});

test('multi-word keywords match across normal whitespace', () => {
  const p = pack('m', 'method', ['sample size']);
  const scores = scorePackDetection([p], ['The sample size was 42; the sample was random.']);
  assert.equal(scores.length, 1);
  assert.equal(scores[0].hits[0].count, 1);
});

test('empty texts and packs with no keyword hits are excluded', () => {
  const p = pack('none', 'field', ['unrelated-keyword']);
  assert.deepEqual(scorePackDetection([p], ['nothing matches here']), []);
  assert.deepEqual(scorePackDetection([p], []), []);
});

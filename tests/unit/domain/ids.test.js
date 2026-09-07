import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHashId, makeId, makeSeqId, parseId, ID_PREFIXES } from '../../../src/domain/ids.js';
import { normalizeText, normalizeKey, stableStringify } from '../../../src/domain/normalize.js';
import { sha256 } from '../../../src/domain/hash.js';

test('sha256 of empty string is known', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
test('normalizeText collapses whitespace, case and unicode', () => {
  assert.equal(normalizeText('  Sample   Size\n\tIs  ３１２ '), 'sample size is 312');
});
test('normalizeKey produces snake_case', () => {
  assert.equal(normalizeKey('Sample Size (N)'), 'sample_size_n');
});
test('makeId is stable and normalized', () => {
  const a = makeId('claim', 'Trust  increases adoption.');
  const b = makeId('claim', 'trust increases adoption.');
  assert.equal(a, b);
  assert.match(a, /^CLAIM-[0-9a-f]{10}$/);
  assert.notEqual(makeId('claim', 'x'), makeId('evidence', 'x'));
});
test('makeId: a method id is derived from its normalized name', () => {
  const a = makeId('method', 'Cross-Sectional  Survey');
  assert.equal(a, makeId('method', 'cross-sectional survey'));
  assert.match(a, /^METH-[0-9a-f]{10}$/);
});
test('makeId over bytes for artifacts', () => {
  assert.match(makeId('artifact', new Uint8Array([1, 2, 3])), /^ART-[0-9a-f]{10}$/);
});
test('makeSeqId and parseId', () => {
  assert.equal(makeSeqId('question', 3), 'RQ-3');
  assert.deepEqual(parseId('RQ-3'), { type: 'question', suffix: '3' });
  assert.deepEqual(parseId('CLAIM-0123456789'), { type: 'claim', suffix: '0123456789' });
  assert.deepEqual(parseId('METH-0123456789'), { type: 'method', suffix: '0123456789' });
  assert.deepEqual(parseId('CAND-0123456789'), { type: 'candidate', suffix: '0123456789' });
  assert.deepEqual(parseId('SEARCH-0123456789'), { type: 'search', suffix: '0123456789' });
  assert.deepEqual(parseId('DATASET-0123456789'), { type: 'dataset', suffix: '0123456789' });
  assert.deepEqual(parseId('ANALYSIS-0123456789'), { type: 'analysis', suffix: '0123456789' });
  assert.deepEqual(parseId('TABLE-0123456789'), { type: 'table', suffix: '0123456789' });
  assert.deepEqual(parseId('FIG-0123456789'), { type: 'figure', suffix: '0123456789' });
  assert.equal(parseId('nope'), null);
  assert.equal(Object.keys(ID_PREFIXES).length, 16);
});

test('makeHashId takes the first ten characters of a content hash', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(
    makeHashId('dataset', sha256(bytes)),
    `DATASET-${makeId('artifact', bytes).slice(4)}`,
  );
  assert.match(makeHashId('dataset', sha256(bytes)), /^DATASET-[0-9a-f]{10}$/);
  assert.throws(() => makeHashId('bogus', sha256(bytes)), /unknown entity type/);
});

test('stableStringify sorts keys at every depth and matches JSON.stringify semantics', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(
    stableStringify({ z: { d: 4, c: [3, { f: 6, e: 5 }] }, a: 1 }),
    '{"a":1,"z":{"c":[3,{"e":5,"f":6}],"d":4}}',
  );
  assert.equal(stableStringify({}), '{}');
  assert.equal(stableStringify({ a: undefined, b: 1 }), '{"b":1}', 'undefined members are dropped');
  assert.equal(stableStringify([1, 'two', null, true]), '[1,"two",null,true]');
  assert.equal(stableStringify([undefined]), '[null]', 'a hole in an array is null, as in JSON');
  assert.equal(stableStringify('x'), '"x"');
  assert.equal(stableStringify(null), 'null');
});

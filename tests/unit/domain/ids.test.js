import test from 'node:test';
import assert from 'node:assert/strict';
import { makeId, makeSeqId, parseId, ID_PREFIXES } from '../../../src/domain/ids.js';
import { normalizeText, normalizeKey } from '../../../src/domain/normalize.js';
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
test('makeId over bytes for artifacts', () => {
  assert.match(makeId('artifact', new Uint8Array([1, 2, 3])), /^ART-[0-9a-f]{10}$/);
});
test('makeSeqId and parseId', () => {
  assert.equal(makeSeqId('question', 3), 'RQ-3');
  assert.deepEqual(parseId('RQ-3'), { type: 'question', suffix: '3' });
  assert.deepEqual(parseId('CLAIM-0123456789'), { type: 'claim', suffix: '0123456789' });
  assert.equal(parseId('nope'), null);
  assert.equal(Object.keys(ID_PREFIXES).length, 9);
});

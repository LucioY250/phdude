import test from 'node:test';
import assert from 'node:assert/strict';
import {
  markContradiction,
  disputedPairs,
  liveContradictions,
} from '../../../src/domain/contradictions.js';
import { PhdudeError } from '../../../src/domain/errors.js';

const created = '2026-09-07T00:00:00Z';
const actor = { researcher: 'test' };

function claim(id, state, statement = `statement ${id}`, contradicts = []) {
  return {
    schema: 'phdude.claim',
    version: 1,
    id,
    created,
    actor,
    statement,
    kind: 'empirical',
    state,
    supported_by: [],
    questions: [],
    sections: [],
    contradicts,
  };
}

test('markContradiction: candidate vs candidate both become disputed', () => {
  const a = claim('CLAIM-a', 'candidate');
  const b = claim('CLAIM-b', 'candidate');
  const result = markContradiction(a, b);
  assert.equal(result.a.state, 'disputed');
  assert.equal(result.b.state, 'disputed');
  assert.deepEqual(result.changed.sort(), ['CLAIM-a', 'CLAIM-b']);
});

test('markContradiction: supported and canonical both become disputed', () => {
  const a = claim('CLAIM-a', 'supported');
  const b = claim('CLAIM-b', 'canonical');
  const result = markContradiction(a, b);
  assert.equal(result.a.state, 'disputed');
  assert.equal(result.b.state, 'disputed');
  assert.deepEqual(result.changed.sort(), ['CLAIM-a', 'CLAIM-b']);
});

test('markContradiction: rejected claim is left unchanged; the other still moves to disputed', () => {
  const a = claim('CLAIM-a', 'rejected');
  const b = claim('CLAIM-b', 'candidate');
  const result = markContradiction(a, b);
  assert.equal(result.a.state, 'rejected');
  assert.equal(result.b.state, 'disputed');
  assert.deepEqual(result.changed, ['CLAIM-b']);
});

test('markContradiction: already-disputed claim stays disputed and is not reported as changed', () => {
  const a = claim('CLAIM-a', 'disputed');
  const b = claim('CLAIM-b', 'candidate');
  const result = markContradiction(a, b);
  assert.equal(result.a.state, 'disputed');
  assert.equal(result.b.state, 'disputed');
  assert.deepEqual(result.changed, ['CLAIM-b']);
});

test('markContradiction: both rejected leaves both unchanged and changed is empty', () => {
  const a = claim('CLAIM-a', 'rejected');
  const b = claim('CLAIM-b', 'rejected');
  const result = markContradiction(a, b);
  assert.equal(result.a.state, 'rejected');
  assert.equal(result.b.state, 'rejected');
  assert.deepEqual(result.changed, []);
});

test('markContradiction: contradicts is recorded symmetrically, deduped and sorted', () => {
  const a = claim('CLAIM-b', 'candidate', 'b', ['CLAIM-z']);
  const b = claim('CLAIM-a', 'candidate');
  const result = markContradiction(a, b);
  assert.deepEqual(result.a.contradicts, ['CLAIM-a', 'CLAIM-z']);
  assert.deepEqual(result.b.contradicts, ['CLAIM-b']);
});

test('markContradiction: calling it twice does not duplicate the contradicts entry', () => {
  const a = claim('CLAIM-a', 'candidate');
  const b = claim('CLAIM-b', 'candidate');
  const once = markContradiction(a, b);
  const twice = markContradiction(once.a, once.b);
  assert.deepEqual(twice.a.contradicts, ['CLAIM-b']);
  assert.deepEqual(twice.b.contradicts, ['CLAIM-a']);
});

test('markContradiction: original objects are not mutated', () => {
  const a = claim('CLAIM-a', 'candidate');
  const b = claim('CLAIM-b', 'candidate');
  markContradiction(a, b);
  assert.equal(a.state, 'candidate');
  assert.deepEqual(a.contradicts, []);
  assert.equal(b.state, 'candidate');
  assert.deepEqual(b.contradicts, []);
});

test('markContradiction: a claim cannot contradict itself', () => {
  const a = claim('CLAIM-a', 'candidate');
  assert.throws(
    () => markContradiction(a, a),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'USAGE');
      assert.match(err.message, /cannot contradict itself/);
      return true;
    },
  );
});

test('disputedPairs: empty when no claim is disputed', () => {
  const claims = [claim('CLAIM-a', 'candidate'), claim('CLAIM-b', 'candidate')];
  assert.deepEqual(disputedPairs(claims), []);
});

test('disputedPairs: one pair reported once regardless of iteration order', () => {
  const claims = [
    claim('CLAIM-b', 'disputed', 'b', ['CLAIM-a']),
    claim('CLAIM-a', 'disputed', 'a', ['CLAIM-b']),
  ];
  assert.deepEqual(disputedPairs(claims), [['CLAIM-a', 'CLAIM-b']]);
});

test('disputedPairs: resolved pairs (neither side disputed) are excluded', () => {
  const claims = [
    claim('CLAIM-a', 'supported', 'a', ['CLAIM-b']),
    claim('CLAIM-b', 'rejected', 'b', ['CLAIM-a']),
  ];
  assert.deepEqual(disputedPairs(claims), []);
});

test('disputedPairs: multiple pairs are sorted deterministically', () => {
  const claims = [
    claim('CLAIM-c', 'disputed', 'c', ['CLAIM-a']),
    claim('CLAIM-a', 'disputed', 'a', ['CLAIM-b', 'CLAIM-c']),
    claim('CLAIM-b', 'disputed', 'b', ['CLAIM-a']),
  ];
  assert.deepEqual(disputedPairs(claims), [
    ['CLAIM-a', 'CLAIM-b'],
    ['CLAIM-a', 'CLAIM-c'],
  ]);
});

test('liveContradictions: lists contradicted ids whose claim is not rejected', () => {
  const a = claim('CLAIM-a', 'supported', 'a', ['CLAIM-b', 'CLAIM-c']);
  const byId = new Map([
    ['CLAIM-b', claim('CLAIM-b', 'disputed', 'b', ['CLAIM-a'])],
    ['CLAIM-c', claim('CLAIM-c', 'candidate', 'c', ['CLAIM-a'])],
  ]);
  assert.deepEqual(liveContradictions(a, byId), ['CLAIM-b', 'CLAIM-c']);
});

test('liveContradictions: a rejected opponent is not live', () => {
  const a = claim('CLAIM-a', 'disputed', 'a', ['CLAIM-b']);
  const byId = new Map([['CLAIM-b', claim('CLAIM-b', 'rejected', 'b', ['CLAIM-a'])]]);
  assert.deepEqual(liveContradictions(a, byId), []);
});

test('liveContradictions: an id with no claim behind it is not live', () => {
  const a = claim('CLAIM-a', 'disputed', 'a', ['CLAIM-gone']);
  assert.deepEqual(liveContradictions(a, new Map()), []);
});

test('liveContradictions: a claim with no contradicts has none', () => {
  assert.deepEqual(liveContradictions(claim('CLAIM-a', 'candidate'), new Map()), []);
});

test('disputedPairs: a pair is live whatever the two states, as long as neither is rejected', () => {
  const claims = [
    claim('CLAIM-a', 'supported', 'a', ['CLAIM-b']),
    claim('CLAIM-b', 'supported', 'b', ['CLAIM-a']),
  ];
  assert.deepEqual(disputedPairs(claims), [['CLAIM-a', 'CLAIM-b']]);
});

test('disputedPairs: a pair drops out once one side is rejected', () => {
  const claims = [
    claim('CLAIM-a', 'rejected', 'a', ['CLAIM-b']),
    claim('CLAIM-b', 'disputed', 'b', ['CLAIM-a']),
  ];
  assert.deepEqual(disputedPairs(claims), []);
});

test('disputedPairs: a one-sided reference is not a pair', () => {
  const claims = [claim('CLAIM-a', 'disputed', 'a', ['CLAIM-b']), claim('CLAIM-b', 'disputed')];
  assert.deepEqual(disputedPairs(claims), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { KNOWLEDGE_STATES, DECISION_STATUS, canTransition } from '../../../src/domain/states.js';
test('states lists', () => {
  assert.deepEqual(KNOWLEDGE_STATES, [
    'canonical',
    'supported',
    'candidate',
    'disputed',
    'rejected',
  ]);
  assert.deepEqual(DECISION_STATUS, ['proposed', 'approved', 'rejected', 'superseded']);
});
test('transitions', () => {
  assert.ok(canTransition('candidate', 'supported'));
  assert.ok(canTransition('supported', 'canonical'));
  assert.ok(canTransition('canonical', 'disputed'));
  assert.ok(!canTransition('rejected', 'canonical'));
  assert.ok(!canTransition('candidate', 'nonsense'));
});

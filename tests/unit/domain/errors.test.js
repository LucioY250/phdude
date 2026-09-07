import test from 'node:test';
import assert from 'node:assert/strict';
import { PhdudeError, EXIT_CODES, exitCodeFor } from '../../../src/domain/errors.js';
test('error carries code and hint and maps to exit code', () => {
  const e = new PhdudeError('POLICY', 'cannot promote', 'approve DEC-1 first');
  assert.equal(e.code, 'POLICY');
  assert.equal(e.hint, 'approve DEC-1 first');
  assert.equal(exitCodeFor(e), EXIT_CODES.POLICY);
  assert.equal(exitCodeFor(new Error('x')), 1);
});

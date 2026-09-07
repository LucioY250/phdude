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

test('a script that failed exits 4, like a tool that was not there', () => {
  const e = new PhdudeError('EXECUTION', 'analysis exited 3', 'phdude analyze runs ANALYSIS-x');
  assert.equal(exitCodeFor(e), EXIT_CODES.EXECUTION);
  assert.equal(EXIT_CODES.EXECUTION, 4);
  assert.equal(EXIT_CODES.TOOL_MISSING, 4);
});

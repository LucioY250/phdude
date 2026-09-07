import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_WORKSPACE_VERSION,
  isNewerThanRuntime,
  needsMigration,
  planChain,
  workspaceVersionOf,
} from '../../../src/domain/versioning.js';

const step = (from, to) => ({ from, to, describe: () => `${from} → ${to}` });

test('the current workspace version is 2', () => {
  assert.equal(CURRENT_WORKSPACE_VERSION, 2);
});

test('a workspace without workspace_version is version 1', () => {
  assert.equal(workspaceVersionOf({ schema: 'phdude.project' }), 1);
  assert.equal(workspaceVersionOf({ workspace_version: undefined }), 1);
  assert.equal(workspaceVersionOf(null), 1);
});

test('workspaceVersionOf reads an explicit version', () => {
  assert.equal(workspaceVersionOf({ workspace_version: 2 }), 2);
  assert.equal(workspaceVersionOf({ workspace_version: 7 }), 7);
});

test('needsMigration is true below the current version and false at or above it', () => {
  assert.equal(needsMigration({}), true);
  assert.equal(needsMigration({ workspace_version: 1 }), true);
  assert.equal(needsMigration({ workspace_version: 2 }), false);
  assert.equal(needsMigration({ workspace_version: 3 }), false);
});

test('isNewerThanRuntime is true only above the current version', () => {
  assert.equal(isNewerThanRuntime({ workspace_version: 3 }), true);
  assert.equal(isNewerThanRuntime({ workspace_version: 2 }), false);
  assert.equal(isNewerThanRuntime({ workspace_version: 1 }), false);
  assert.equal(isNewerThanRuntime({}), false);
  assert.equal(isNewerThanRuntime(null), false);
});

test('planChain returns the steps between two versions in order', () => {
  const steps = [step(2, 3), step(1, 2)];
  assert.deepEqual(
    planChain(steps, 1, 3).map((s) => [s.from, s.to]),
    [
      [1, 2],
      [2, 3],
    ],
  );
  assert.deepEqual(
    planChain(steps, 1, 2).map((s) => [s.from, s.to]),
    [[1, 2]],
  );
});

test('planChain is empty when the workspace is already current', () => {
  assert.deepEqual(planChain([step(1, 2)], 2, 2), []);
});

test('planChain throws VALIDATION on a missing step', () => {
  assert.throws(() => planChain([step(1, 2)], 1, 3), {
    code: 'VALIDATION',
    message: /no migration from workspace version 2/,
  });
});

test('planChain throws VALIDATION on a step that does not advance the version', () => {
  assert.throws(() => planChain([step(1, 1)], 1, 2), {
    code: 'VALIDATION',
    message: /does not advance/,
  });
});

test('planChain throws VALIDATION when the workspace is newer than this phdude', () => {
  assert.throws(() => planChain([step(1, 2)], 3, 2), {
    code: 'VALIDATION',
    message: /workspace version 3 is newer than 2/,
  });
});

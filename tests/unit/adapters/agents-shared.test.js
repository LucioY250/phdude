import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderAgentsMd,
  isPhdudeManaged,
  MANAGED_MARKER,
} from '../../../src/adapters/agents/shared.js';

test('renderAgentsMd starts with the managed marker and inlines skills deterministically', async () => {
  const text = await renderAgentsMd({ project: { title: 'My thesis' } });
  assert.ok(text.startsWith(MANAGED_MARKER));
  assert.match(text, /# PhDude research workspace/);
  assert.match(text, /## Skill: bootstrap/);
  assert.match(text, /My thesis/);
  const text2 = await renderAgentsMd({ project: { title: 'My thesis' } });
  assert.equal(text, text2);
});

test('isPhdudeManaged recognizes the first-line marker and an unmanaged file', () => {
  assert.equal(isPhdudeManaged(`${MANAGED_MARKER}\nbody`), true);
  assert.equal(isPhdudeManaged('# not managed\n'), false);
  assert.equal(isPhdudeManaged(null), false);
});

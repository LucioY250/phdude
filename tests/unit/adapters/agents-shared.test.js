import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderAgentsMd,
  isPhdudeManaged,
  parseFrontMatter,
  MANAGED_MARKER,
  SKILLS_INDEX_MARKER,
} from '../../../src/adapters/agents/shared.js';

test('renderAgentsMd (inlineSkills: true) starts with the marker and inlines skills deterministically', async () => {
  const text = await renderAgentsMd({ project: { title: 'My thesis' }, inlineSkills: true });
  assert.ok(text.startsWith(MANAGED_MARKER));
  assert.match(text, /# PhDude research workspace/);
  assert.match(text, /## Skill: bootstrap/);
  assert.match(text, /My thesis/);
  assert.doesNotMatch(text, /phdude:skills-index/);
  const text2 = await renderAgentsMd({ project: { title: 'My thesis' }, inlineSkills: true });
  assert.equal(text, text2);
});

test('renderAgentsMd (inlineSkills: false) is an index, listing each skill by name and description', async () => {
  const text = await renderAgentsMd({ project: { title: 'My thesis' }, inlineSkills: false });
  assert.ok(text.startsWith(MANAGED_MARKER));
  assert.match(text, new RegExp(SKILLS_INDEX_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(text, /## Skill: bootstrap/);
  assert.match(text, /\*\*bootstrap\*\*.*\.phdude\/skills\/bootstrap\/SKILL\.md/);
});

test('isPhdudeManaged recognizes the first-line marker and an unmanaged file', () => {
  assert.equal(isPhdudeManaged(`${MANAGED_MARKER}\nbody`), true);
  assert.equal(isPhdudeManaged('# not managed\n'), false);
  assert.equal(isPhdudeManaged(null), false);
});

test('parseFrontMatter does not throw on invalid YAML front matter', () => {
  const { meta, body } = parseFrontMatter('---\n: bad: [\n---\nnotes\n');
  assert.equal(meta, null);
  assert.equal(body, '---\n: bad: [\n---\nnotes\n');
});

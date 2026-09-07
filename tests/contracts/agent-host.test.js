import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentHostContract } from '../../src/ports/agent-host.js';
import { claudeCodeHost } from '../../src/adapters/agents/claude-code.js';
import { codexHost } from '../../src/adapters/agents/codex.js';

const mkroot = () => mkdtemp(join(tmpdir(), 'phdude-'));

agentHostContract(test, assert, { mkdtemp: mkroot, readFile }, claudeCodeHost);
agentHostContract(test, assert, { mkdtemp: mkroot, readFile }, codexHost);

test('claude-code writes CLAUDE.md and one command per template', async () => {
  const root = await mkroot();
  const { written } = await claudeCodeHost.install(root, { project: { title: 'T' } });
  assert.ok(written.includes('CLAUDE.md'));
  assert.ok(written.some((f) => f === join('.claude', 'commands', 'phdude.md')));
  assert.ok(written.some((f) => f === join('.claude', 'commands', 'phdude-bootstrap.md')));
  assert.match(await readFile(join(root, 'CLAUDE.md'), 'utf8'), /@AGENTS\.md/);
});

test('claude-code leaves a pre-existing unmanaged AGENTS.md untouched', async () => {
  const root = await mkroot();
  await writeFile(join(root, 'AGENTS.md'), '# my own notes\n');
  const { written, skipped } = await claudeCodeHost.install(root, { project: { title: 'T' } });
  assert.ok(skipped.includes('AGENTS.md'));
  assert.ok(!written.includes('AGENTS.md'));
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), '# my own notes\n');
});

test('codex writes AGENTS.md with skills inlined', async () => {
  const root = await mkroot();
  await codexHost.install(root, { project: { title: 'T' } });
  assert.match(await readFile(join(root, 'AGENTS.md'), 'utf8'), /## Skill: bootstrap/);
});

test('codex writes no slash commands', async () => {
  const root = await mkroot();
  const { written } = await codexHost.install(root, { project: { title: 'T' } });
  assert.deepEqual(written, ['AGENTS.md']);
});

test('claude-code AGENTS.md is a skills index, not full inlining', async () => {
  const root = await mkroot();
  await claudeCodeHost.install(root, { project: { title: 'T' } });
  const text = await readFile(join(root, 'AGENTS.md'), 'utf8');
  assert.match(text, /<!-- phdude:skills-index -->/);
  assert.doesNotMatch(text, /## Skill: bootstrap/);
});

test('codex alone still inlines every skill in full', async () => {
  const root = await mkroot();
  await codexHost.install(root, { project: { title: 'T' } });
  const text = await readFile(join(root, 'AGENTS.md'), 'utf8');
  assert.match(text, /## Skill: bootstrap/);
  assert.doesNotMatch(text, /<!-- phdude:skills-index -->/);
});

test('when both hosts install, the claude-code index variant wins and codex leaves it alone', async () => {
  const root = await mkroot();
  await claudeCodeHost.install(root, { project: { title: 'T' } });
  const { written, skipped } = await codexHost.install(root, { project: { title: 'T' } });
  assert.deepEqual(written, []);
  assert.deepEqual(skipped, ['AGENTS.md']);
  const text = await readFile(join(root, 'AGENTS.md'), 'utf8');
  assert.match(text, /<!-- phdude:skills-index -->/);
  assert.doesNotMatch(text, /## Skill: bootstrap/);
});

test('a pre-existing AGENTS.md with malformed front matter is left alone, not thrown on', async () => {
  const root = await mkroot();
  const malformed = '---\n: bad: [\n---\nmy notes\n';
  await writeFile(join(root, 'AGENTS.md'), malformed);

  const r1 = await claudeCodeHost.install(root, { project: { title: 'T' } });
  assert.ok(r1.skipped.includes('AGENTS.md'));
  assert.ok(!r1.written.includes('AGENTS.md'));

  const r2 = await codexHost.install(root, { project: { title: 'T' } });
  assert.deepEqual(r2.skipped, ['AGENTS.md']);
  assert.deepEqual(r2.written, []);

  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), malformed);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentHostContract } from '../../src/ports/agent-host.js';
import { claudeCodeHost } from '../../src/adapters/agents/claude-code.js';
import { codexHost } from '../../src/adapters/agents/codex.js';
import { opencodeHost } from '../../src/adapters/agents/opencode.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mkroot = () => mkdtemp(join(tmpdir(), 'phdude-'));

agentHostContract(test, assert, { mkdtemp: mkroot, readFile }, claudeCodeHost);
agentHostContract(test, assert, { mkdtemp: mkroot, readFile }, codexHost);
agentHostContract(test, assert, { mkdtemp: mkroot, readFile }, opencodeHost);

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

test('opencode writes one command per template under .opencode/command/', async () => {
  const root = await mkroot();
  const { written } = await opencodeHost.install(root, { project: { title: 'T' } });
  const templates = readdirSync(join(REPO_ROOT, 'commands')).filter((f) => f.endsWith('.md'));

  assert.ok(written.includes(join('.opencode', 'command', 'phdude.md')));
  assert.ok(written.includes(join('.opencode', 'command', 'phdude-bootstrap.md')));
  assert.equal(written.filter((f) => f.startsWith('.opencode')).length, templates.length);
});

test('an opencode command keeps the template body and $ARGUMENTS', async () => {
  const root = await mkroot();
  await opencodeHost.install(root, { project: { title: 'T' } });
  const text = await readFile(join(root, '.opencode', 'command', 'phdude-status.md'), 'utf8');
  const template = readFileSync(join(REPO_ROOT, 'commands', 'status.md'), 'utf8');

  assert.ok(text.includes('$ARGUMENTS'));
  assert.equal(text.split('\n---\n')[1], template.split('\n---\n')[1]);
});

test('opencode command front matter keeps description and drops allowed-tools', async () => {
  const root = await mkroot();
  await opencodeHost.install(root, { project: { title: 'T' } });
  for (const file of readdirSync(join(root, '.opencode', 'command'))) {
    const text = await readFile(join(root, '.opencode', 'command', file), 'utf8');
    assert.ok(text.startsWith('---\n'), `${file}: front matter must start at line 1`);
    assert.match(text, /\ndescription: \S/, `${file}: no description`);
    assert.match(text, /\nphdude-managed: true\n/, `${file}: not marked managed`);
    assert.doesNotMatch(text, /\nallowed-tools:/, `${file}: allowed-tools is a Claude Code key`);
  }
});

test('opencode AGENTS.md is the skills index, not full inlining', async () => {
  const root = await mkroot();
  await opencodeHost.install(root, { project: { title: 'T' } });
  const text = await readFile(join(root, 'AGENTS.md'), 'utf8');
  assert.match(text, /<!-- phdude:skills-index -->/);
  assert.doesNotMatch(text, /## Skill: bootstrap/);
});

test('opencode writes the same AGENTS.md as claude-code, so neither rewrites the other', async () => {
  const root = await mkroot();
  await claudeCodeHost.install(root, { project: { title: 'T' } });
  const before = await readFile(join(root, 'AGENTS.md'), 'utf8');

  const { written, skipped } = await opencodeHost.install(root, { project: { title: 'T' } });
  assert.ok(!written.includes('AGENTS.md'));
  assert.ok(skipped.includes('AGENTS.md'));
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), before);
});

test('codex leaves the index variant opencode wrote alone', async () => {
  const root = await mkroot();
  await opencodeHost.install(root, { project: { title: 'T' } });
  const { written, skipped } = await codexHost.install(root, { project: { title: 'T' } });
  assert.deepEqual(written, []);
  assert.deepEqual(skipped, ['AGENTS.md']);
  assert.doesNotMatch(await readFile(join(root, 'AGENTS.md'), 'utf8'), /## Skill: bootstrap/);
});

test('opencode leaves a pre-existing unmanaged command file untouched', async () => {
  const root = await mkroot();
  await mkdir(join(root, '.opencode', 'command'), { recursive: true });
  await writeFile(join(root, '.opencode', 'command', 'phdude-status.md'), '# mine\n');

  const rel = join('.opencode', 'command', 'phdude-status.md');
  const { written, skipped } = await opencodeHost.install(root, { project: { title: 'T' } });
  assert.ok(skipped.includes(rel));
  assert.ok(!written.includes(rel));
  assert.equal(await readFile(join(root, rel), 'utf8'), '# mine\n');
});

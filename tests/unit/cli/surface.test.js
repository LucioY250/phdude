import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMAND_OPTIONS } from '../../../src/adapters/cli/args.js';
import { usage } from '../../../src/adapters/cli/commands/help.js';
import { COMMAND_ROWS } from '../../../src/adapters/agents/shared.js';
import { claudeCodeHost } from '../../../src/adapters/agents/claude-code.js';

// Every surface that names a command drifted at least once during v0.1 and v0.2: the AGENTS.md
// table, the slash-command templates, docs/cli.md and the README all listed a different set. The
// option table in adapters/cli/args.js is what the parser actually accepts, so it is the
// authority here and every other surface is checked against it.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const COMMANDS = Object.keys(COMMAND_OPTIONS).sort();

const read = (...parts) => readFileSync(join(REPO_ROOT, ...parts), 'utf8');

// `phdude.md` is the dispatcher (`/phdude`), not a command of its own.
const DISPATCHER_TEMPLATE = 'phdude.md';

function usageCommands() {
  const names = [];
  let inCommands = false;
  for (const line of usage().split('\n')) {
    if (line === 'Commands:') {
      inCommands = true;
      continue;
    }
    if (!inCommands) continue;
    if (line.trim() === '') break;
    const m = /^ {2}([a-z][a-z-]*)\b/.exec(line);
    if (m) names.push(m[1]);
  }
  return names.sort();
}

test('the usage block lists exactly the commands the parser accepts', () => {
  assert.deepEqual(usageCommands(), COMMANDS);
});

test('AGENTS.md command table has a row for every command', () => {
  const rows = COMMAND_ROWS.map(([cmd]) => cmd.split(' ')[0]).sort();
  assert.deepEqual(rows, COMMANDS);
});

test('commands/ has one slash-command template per command, and no orphans', () => {
  const files = readdirSync(join(REPO_ROOT, 'commands')).filter((f) => f.endsWith('.md'));
  const templates = files
    .filter((f) => f !== DISPATCHER_TEMPLATE)
    .map((f) => f.replace(/\.md$/, ''));
  assert.ok(files.includes(DISPATCHER_TEMPLATE), 'the /phdude dispatcher template is missing');
  assert.deepEqual(templates.sort(), COMMANDS);
});

test('every slash-command template carries the front matter Claude Code needs', () => {
  for (const file of readdirSync(join(REPO_ROOT, 'commands'))) {
    const text = read('commands', file);
    assert.ok(text.startsWith('---\n'), `commands/${file}: front matter must start at line 1`);
    assert.match(text, /\ndescription: \S/, `commands/${file}: no description`);
    assert.match(text, /\nphdude-managed: true\n/, `commands/${file}: not marked managed`);
  }
});

test('docs/cli.md has a reference section for every command', () => {
  const doc = read('docs', 'cli.md');
  const headings = [...doc.matchAll(/^### `phdude ([a-z][a-z-]*)/gm)].map((m) => m[1]);
  for (const command of COMMANDS) {
    assert.ok(headings.includes(command), `docs/cli.md has no "### \`phdude ${command}\`" section`);
  }
});

test('the README command table has a row for every command', () => {
  const readme = read('README.md');
  const rows = [...readme.matchAll(/^\| `phdude ([a-z][a-z-]*)/gm)].map((m) => m[1]);
  for (const command of COMMANDS) {
    assert.ok(rows.includes(command), `README.md's command table has no row for ${command}`);
  }
});

test('the README slash-command list names every installed template', () => {
  const readme = read('README.md');
  for (const command of COMMANDS) {
    assert.ok(
      readme.includes(`\`/phdude-${command}\``),
      `README.md does not mention the /phdude-${command} slash command`,
    );
  }
});

test("CLAUDE.md's slash-command list names every command", async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-surface-'));
  await claudeCodeHost.install(root, { project: { title: 'Surface' } });
  const claudeMd = await readFile(join(root, 'CLAUDE.md'), 'utf8');

  assert.ok(claudeMd.includes('`/phdude`'), 'the dispatcher is missing');
  for (const command of COMMANDS) {
    assert.ok(
      claudeMd.includes(`\`/phdude-${command}\``),
      `CLAUDE.md does not name the /phdude-${command} slash command`,
    );
  }
});

// The writing commands are the ones a researcher meets as a workflow rather than one at a time,
// so the README owes them a worked section and not only a table row.
test("the README's writing section walks through every writing command", () => {
  const readme = read('README.md');
  const start = readme.indexOf('## Writing with PhDude');
  assert.notEqual(start, -1, 'README.md has no "Writing with PhDude" section');
  const section = readme.slice(start, readme.indexOf('\n## ', start + 1));

  for (const command of ['manuscript', 'write', 'deslop', 'prose', 'authors']) {
    assert.ok(
      section.includes(`phdude ${command}`),
      `README.md's writing section never runs \`phdude ${command}\``,
    );
  }
});

// PRD §30c makes optimizing for an AI-detector score a prohibited goal. `args.js` enforces it and
// `args.test.js` proves the enforcement; what this checks is that a researcher is told, in the
// places they actually read, rather than only finding out when a command exits 3.
test('the no-detector rule is stated on every surface a researcher reads', () => {
  const surfaces = [
    ['README.md'],
    ['docs', 'cli.md'],
    ['docs', 'adr', '0008-writing-pipeline-and-no-detector-rule.md'],
    ['skills', 'academic-prose', 'SKILL.md'],
  ];
  for (const parts of surfaces) {
    const text = read(...parts);
    assert.match(
      text,
      /detector score/i,
      `${parts.join('/')} never states that PhDude has no detector score`,
    );
  }
});

test('the phdude-core skill lists every write command as CLI-only', () => {
  // Only these commands mutate recorded research state; the skill's "the only way to write"
  // section has to name each of them, or an agent will reach for a file edit instead.
  const writeCommands = [
    'add',
    'link',
    'edit',
    'decide',
    'promote',
    'research accept',
    'research dismiss',
    'packs apply',
    'mode',
    'authors add',
    'authors learn',
    'authors consensus',
    'manuscript init',
    'manuscript submit',
    'manuscript approve',
    'manuscript reopen',
    'data add',
    'analyze add',
    'analyze run',
    'deslop',
  ];
  const skill = read('skills', 'phdude-core', 'SKILL.md');
  const section = skill.slice(skill.indexOf('## The only way to write'));
  for (const command of writeCommands) {
    assert.ok(
      section.includes(`phdude ${command}`),
      `skills/phdude-core/SKILL.md does not name \`phdude ${command}\` as a write command`,
    );
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { ALLOWED_FIELDS } from '../../src/application/add.js';
import { parseCli } from '../../src/adapters/cli/args.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_DIR = join(ROOT, 'skills');
const COMMANDS_DIR = join(ROOT, 'commands');
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// A skill writes nothing: the CLI is the only writer of recorded state. `academic-prose` is the
// one exception the PRD carves out (§30b), and even there the writes go through
// `phdude manuscript submit`, never through a file edit - so the declaration is `manuscript/**`
// and nothing else.
const DECLARED_WRITES = { 'academic-prose': ['manuscript/**'] };

for (const name of readdirSync(SKILLS_DIR)) {
  test(`skills/${name}/SKILL.md has valid phdude front matter`, () => {
    const text = readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
    const m = FRONT_MATTER_RE.exec(text);
    assert.ok(m, 'front matter block found');
    const meta = parse(m[1]);
    assert.equal(meta.name, name);
    assert.equal(typeof meta.description, 'string');
    assert.ok(meta.description.length > 0);
    assert.equal(meta.phdude.version, 1);
    assert.deepEqual(meta.phdude.writes, DECLARED_WRITES[name] ?? []);
  });
}

// Every `phdude add <type> --json '<obj>'` the documentation tells an agent to run must
// survive addEntity's unknown-field check, or the docs teach a command that exits 2.
const ADD_EXAMPLE_RE = /phdude add (\S+) --json '(\{.*\})'/g;

function markdownFiles() {
  const files = [];
  for (const name of readdirSync(SKILLS_DIR)) files.push(join(SKILLS_DIR, name, 'SKILL.md'));
  for (const name of readdirSync(COMMANDS_DIR)) files.push(join(COMMANDS_DIR, name));
  return files;
}

test('documented `phdude add` examples use only fields addEntity accepts', () => {
  let checked = 0;
  for (const file of markdownFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const [, type, payload] of text.matchAll(ADD_EXAMPLE_RE)) {
      const allowed = ALLOWED_FIELDS[type];
      assert.ok(allowed, `${file}: documents an unknown type "${type}"`);
      const unknown = Object.keys(JSON.parse(payload)).filter((k) => !allowed.includes(k));
      assert.deepEqual(unknown, [], `${file}: ${type} example uses unknown field(s)`);
      checked++;
    }
  }
  assert.ok(checked >= 5, `expected several documented add examples, found ${checked}`);
});

// Every `phdude …` line a skill or slash command tells an agent to run, joined across `\`
// continuations. Parsing is deliberately shell-shaped: single and double quotes hold a token
// together, so a JSON payload stays one argument the way it does in a real shell.
function commandLines(text) {
  const lines = [];
  let pending = null;
  let fenced = false;
  for (const raw of text.split('\n')) {
    if (raw.trimStart().startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) continue;
    const line = raw.trim();
    if (pending !== null) {
      pending += ' ' + line.replace(/\\$/, '').trim();
      if (!line.endsWith('\\')) {
        lines.push(pending);
        pending = null;
      }
      continue;
    }
    if (!line.startsWith('phdude ')) continue;
    if (line.endsWith('\\')) pending = line.replace(/\\$/, '').trim();
    else lines.push(line);
  }
  return lines;
}

function tokenize(line) {
  const tokens = [];
  let current = '';
  let quote = null;
  let started = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === ' ') {
      if (started || current !== '') tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += ch;
  }
  if (started || current !== '') tokens.push(current);
  return tokens;
}

test('every documented `phdude` command parses under the strict option table', () => {
  let checked = 0;
  for (const file of markdownFiles()) {
    for (const line of commandLines(readFileSync(file, 'utf8'))) {
      const argv = tokenize(line).slice(1);
      try {
        parseCli(argv);
      } catch (err) {
        assert.fail(`${file}: \`${line}\` fails to parse: ${err.message}`);
      }
      checked++;
    }
  }
  // Guards against the extraction silently matching nothing and passing vacuously.
  assert.ok(
    checked >= 25,
    `expected the skills and commands to document many CLI calls, found ${checked}`,
  );
});

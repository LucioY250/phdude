import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { ALLOWED_FIELDS } from '../../src/application/add.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_DIR = join(ROOT, 'skills');
const COMMANDS_DIR = join(ROOT, 'commands');
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

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
    assert.deepEqual(meta.phdude.writes, []);
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

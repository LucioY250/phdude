import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');
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

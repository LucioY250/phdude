import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { RULES, lint } from '../../src/domain/prose-lint.js';
import { loadSkill } from '../../src/adapters/skills/loader.js';
import { DEFAULT_SKILLS_DIR } from '../../src/adapters/agents/shared.js';

// The `academic-prose` skill ships its own fixture tests (PRD §30b): text that must pass, text
// that must be flagged. They are YAML so a researcher can add a case without writing JavaScript;
// this runner is what executes them, against the same `lint` the CLI and the prose gate use.
const SKILL_DIR = join(DEFAULT_SKILLS_DIR, 'academic-prose');
const TESTS_DIR = join(SKILL_DIR, 'tests');

function loadCases(file) {
  const doc = parse(readFileSync(join(TESTS_DIR, file), 'utf8'));
  assert.ok(Array.isArray(doc.cases), `${file}: no cases`);
  return doc.cases.map((entry) => ({ ...entry, lang: entry.lang ?? doc.lang ?? 'en' }));
}

const FILES = readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.yaml'))
  .sort();

test('the skill ships the three fixture files PRD §30b names', () => {
  assert.deepEqual(FILES, ['academic.yaml', 'ai-slop.yaml', 'human-writing.yaml']);
});

for (const file of FILES) {
  for (const testCase of loadCases(file)) {
    test(`academic-prose/${file}: ${testCase.name}`, () => {
      assert.equal(typeof testCase.text, 'string', 'the case has no text');
      const fired = [
        ...new Set(lint(testCase.text, { lang: testCase.lang }).observations.map((o) => o.rule)),
      ].sort();

      if (Array.isArray(testCase.expect)) {
        assert.deepEqual(
          fired,
          [...testCase.expect].sort(),
          `fired: ${fired.join(', ') || '(none)'}`,
        );
        return;
      }
      assert.ok(Array.isArray(testCase.absent), 'a case needs either `expect` or `absent`');
      for (const rule of testCase.absent) {
        assert.ok(
          !fired.includes(rule),
          `${rule} should not fire here (fired: ${fired.join(', ')})`,
        );
      }
    });
  }
}

test('every rule name a fixture names is a rule the linter has', () => {
  const named = new Set();
  for (const file of FILES) {
    for (const testCase of loadCases(file)) {
      for (const rule of [...(testCase.expect ?? []), ...(testCase.absent ?? [])]) named.add(rule);
    }
  }
  for (const rule of named) assert.ok(RULES.includes(rule), `unknown rule in a fixture: ${rule}`);
  for (const rule of RULES) assert.ok(named.has(rule), `no fixture exercises ${rule}`);
});

test('the academic-prose contract declares the writing pipeline it belongs to', async () => {
  const skill = await loadSkill(SKILL_DIR);
  assert.deepEqual(skill.warnings, []);
  assert.equal(skill.contract.version, 1);
  assert.deepEqual(skill.contract.writes, ['manuscript/**']);
  assert.equal(skill.contract.permissions.network, 'none');
  assert.deepEqual(skill.contract.permissions.workspace, ['read', 'write:manuscript']);
  assert.deepEqual(skill.contract.quality_gates, [
    'gate-citations',
    'gate-evidence',
    'gate-prose',
    'gate-voice',
    'gate-meaning',
  ]);
  assert.deepEqual(skill.contract.approval_gates, ['manuscript-approve']);
  for (const path of ['manuscript/**', 'knowledge/claims/**', 'authors/**']) {
    assert.ok(skill.contract.reads.includes(path), `the contract does not read ${path}`);
  }
});

test('the skill states the no-detector rule and ships its references and script', () => {
  const skillMd = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
  assert.match(skillMd, /§30c/, 'SKILL.md does not cite the no-detector rule');
  assert.match(skillMd, /does not measure, report, target or optimize against an AI-detection/);

  for (const rel of [
    'references/ai-writing-patterns.md',
    'references/epistemic-language.md',
    'scripts/prose-lint.mjs',
  ]) {
    assert.ok(statSync(join(SKILL_DIR, rel)).size > 0, `${rel} is missing or empty`);
  }
});

test('the skill script is a wrapper over the CLI, not a second copy of the rules', () => {
  const script = readFileSync(join(SKILL_DIR, 'scripts', 'prose-lint.mjs'), 'utf8');
  assert.match(script, /execFile\(\s*'phdude'/, 'the script should run phdude from PATH');
  assert.match(script, /'prose', '--file'/);
  assert.match(script, /detect\|humaniz/, 'the script must refuse detector options too');
  assert.doesNotMatch(script, /import .* from '.*prose-lint\.js'/, 'it must not import the core');
});

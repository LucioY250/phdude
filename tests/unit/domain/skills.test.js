import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNoDetectorPurpose,
  classifySkillSource,
  detectorPurpose,
  emptyLock,
  findLocked,
  removeLocked,
  skillTreeHash,
  upsertLocked,
} from '../../../src/domain/skills.js';
import { PhdudeError } from '../../../src/domain/errors.js';

const bytes = (text) => Buffer.from(text, 'utf8');

test('detectorPurpose names the phrase that made a skill a detector skill', () => {
  assert.equal(detectorPurpose(['bypass the gate']), null);
  assert.equal(detectorPurpose(['Teaches detection bypass']), 'detection bypass');
  assert.equal(detectorPurpose(['for detector evasion']), 'detector evasion');
  assert.equal(detectorPurpose(['a humanizer for drafts']), 'humaniz');
  assert.equal(detectorPurpose(['raises your humanity score']), 'humanity score');
});

test('detectorPurpose ignores a skill that only reads like one', () => {
  assert.equal(detectorPurpose(['outlier detection in survey data']), null);
  assert.equal(detectorPurpose([undefined, null, '']), null);
});

test('assertNoDetectorPurpose refuses with POLICY and names the phrase', () => {
  assert.throws(
    () => assertNoDetectorPurpose('ghostwriter', ['ghostwriter', 'humanize a draft']),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'POLICY');
      assert.match(err.message, /skill ghostwriter/);
      assert.match(err.message, /humaniz/);
      assert.match(err.hint, /§30c/);
      return true;
    },
  );
});

test('assertNoDetectorPurpose passes an ordinary skill', () => {
  assertNoDetectorPurpose('literature', ['literature', 'Search and screen the literature.']);
});

test('classifySkillSource reads an https URL as a git source and a bare path as a path', () => {
  assert.deepEqual(classifySkillSource('https://example.org/lab/skill.git'), {
    kind: 'git',
    url: 'https://example.org/lab/skill.git',
  });
  assert.deepEqual(classifySkillSource('./skills/my-skill'), {
    kind: 'path',
    path: './skills/my-skill',
  });
  assert.deepEqual(classifySkillSource('/tmp/my-skill'), { kind: 'path', path: '/tmp/my-skill' });
});

test('classifySkillSource refuses every transport but https', () => {
  for (const source of [
    'http://example.org/skill.git',
    'git://example.org/skill.git',
    'ssh://git@example.org/skill.git',
    'file:///tmp/skill',
    'git@github.com:lab/skill.git',
  ]) {
    assert.throws(() => classifySkillSource(source), {
      code: 'VALIDATION',
      message: `unsupported skill source: ${source}`,
    });
  }
});

test('classifySkillSource refuses a URL carrying credentials', () => {
  assert.throws(() => classifySkillSource('https://user:token@example.org/lab/skill.git'), {
    code: 'VALIDATION',
    message: 'a skill URL must not carry credentials',
  });
});

test('classifySkillSource refuses an empty source', () => {
  assert.throws(() => classifySkillSource('   '), { code: 'USAGE' });
});

test('skillTreeHash is stable under file order and moves with a byte or a rename', () => {
  const tree = [
    { path: 'SKILL.md', bytes: bytes('---\nname: a\n---\n') },
    { path: 'references/checklist.md', bytes: bytes('# checklist\n') },
  ];
  const base = skillTreeHash(tree);

  assert.equal(skillTreeHash([...tree].reverse()), base);
  assert.match(base, /^[0-9a-f]{64}$/);

  const edited = [tree[0], { path: 'references/checklist.md', bytes: bytes('# checklist!\n') }];
  assert.notEqual(skillTreeHash(edited), base);

  const renamed = [tree[0], { path: 'references/list.md', bytes: tree[1].bytes }];
  assert.notEqual(skillTreeHash(renamed), base);
});

test('the lock keeps one entry per skill, sorted by name', () => {
  const at = '2026-09-08T00:00:00.000Z';
  let lock = emptyLock();
  assert.deepEqual(lock, { schema: 'phdude.skills-lock', version: 1, skills: [] });

  lock = upsertLocked(lock, {
    name: 'zeta',
    source: '/tmp/zeta',
    hash: 'a'.repeat(64),
    installed_at: at,
  });
  lock = upsertLocked(lock, {
    name: 'alpha',
    source: '/tmp/alpha',
    hash: 'b'.repeat(64),
    installed_at: at,
  });
  assert.deepEqual(
    lock.skills.map((s) => s.name),
    ['alpha', 'zeta'],
  );

  lock = upsertLocked(lock, {
    name: 'zeta',
    source: '/tmp/zeta',
    hash: 'c'.repeat(64),
    installed_at: at,
  });
  assert.equal(lock.skills.length, 2);
  assert.equal(findLocked(lock, 'zeta').hash, 'c'.repeat(64));

  lock = removeLocked(lock, 'alpha');
  assert.deepEqual(
    lock.skills.map((s) => s.name),
    ['zeta'],
  );
  assert.equal(findLocked(lock, 'alpha'), null);
});

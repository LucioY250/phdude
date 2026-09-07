import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTION_STATUSES,
  SECTION_TRANSITIONS,
  STANDARD_SECTIONS,
  canTransition,
  newManuscript,
  parseSectionFile,
  renderSectionFile,
  sectionHash,
  slugify,
} from '../../../src/domain/manuscript.js';

test('the standard sections are the PRD §33 order', () => {
  assert.deepEqual(
    STANDARD_SECTIONS.map((s) => s.id),
    ['abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusions'],
  );
});

test('newManuscript plans every standard section without writing a file', () => {
  const m = newManuscript({ title: 'A thesis', language: 'en', voice: { kind: 'consensus' } });
  assert.equal(m.schema, 'phdude.manuscript');
  assert.equal(m.version, 1);
  assert.equal(m.title, 'A thesis');
  assert.equal(m.language, 'en');
  assert.deepEqual(m.voice, { kind: 'consensus' });
  assert.equal(m.sections.length, STANDARD_SECTIONS.length);
  for (const [i, section] of m.sections.entries()) {
    assert.equal(section.status, 'planned');
    assert.equal(section.hash, null);
    assert.equal(section.order, i + 1);
    assert.equal(section.file, `manuscript/${section.id}.md`);
    assert.deepEqual(section.claims, []);
    assert.deepEqual(section.questions, []);
    assert.ok(!('approved_by' in section));
  }
});

test('newManuscript keeps an author voice', () => {
  const m = newManuscript({
    title: 'T',
    language: 'es',
    voice: { kind: 'author', author: 'researcher-a' },
  });
  assert.deepEqual(m.voice, { kind: 'author', author: 'researcher-a' });
});

test('sectionHash normalizes line endings and trailing whitespace', () => {
  const base = sectionHash('# Title\n\nOne paragraph.\n');
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(sectionHash('# Title\r\n\r\nOne paragraph.\r\n'), base);
  assert.equal(sectionHash('# Title   \n\nOne paragraph.  \n'), base);
  assert.equal(sectionHash('# Title\n\nOne paragraph.\n\n\n'), base);
  assert.notEqual(sectionHash('# Title\n\nAnother paragraph.\n'), base);
});

test('sectionHash keeps interior whitespace, which is prose', () => {
  assert.notEqual(sectionHash('a\n\nb\n'), sectionHash('a\nb\n'));
});

test('section statuses and their transitions', () => {
  assert.deepEqual(SECTION_STATUSES, ['planned', 'draft', 'revised', 'approved']);
  assert.deepEqual(SECTION_TRANSITIONS.planned, ['draft']);
  assert.deepEqual(SECTION_TRANSITIONS.draft, ['revised', 'approved']);
  assert.deepEqual(SECTION_TRANSITIONS.revised, ['revised', 'approved']);
  assert.deepEqual(SECTION_TRANSITIONS.approved, []);

  assert.ok(canTransition('planned', 'draft'));
  assert.ok(canTransition('draft', 'approved'));
  assert.ok(canTransition('revised', 'approved'));
  assert.ok(!canTransition('planned', 'approved'));
  assert.ok(!canTransition('planned', 'revised'));
  assert.ok(!canTransition('approved', 'revised'), 'approved reopens through reopen, not submit');
  assert.ok(!canTransition('draft', 'nonsense'));
});

test('renderSectionFile and parseSectionFile round-trip', () => {
  const front = {
    section: 'introduction',
    status: 'draft',
    hash: 'a'.repeat(64),
    updated: '2026-09-07T00:00:00.000Z',
  };
  const body = '# Introduction\n\nSMEs adopt AI slowly [@smith2020adoption].\n';
  const text = renderSectionFile(front, body);
  assert.ok(text.startsWith('---\n'));
  assert.deepEqual(parseSectionFile(text), { front, body });
});

test('parseSectionFile treats a file without front matter as all body', () => {
  const text = '# Introduction\n\nA draft the agent just wrote.\n';
  assert.deepEqual(parseSectionFile(text), { front: {}, body: text });
});

test('parseSectionFile strips the stale front matter of a resubmitted section', () => {
  const text = ['---', 'section: methods', 'status: draft', '---', '', 'New body.', ''].join('\n');
  const { front, body } = parseSectionFile(text);
  assert.equal(front.section, 'methods');
  assert.equal(front.status, 'draft');
  assert.equal(body, 'New body.\n');
});

test('slugify makes section ids out of titles', () => {
  assert.equal(slugify('Introduction'), 'introduction');
  assert.equal(slugify('Results and Discussion'), 'results-and-discussion');
  assert.equal(slugify('  Métodos  '), 'metodos');
  assert.equal(slugify('Chapter 1: the setup!'), 'chapter-1-the-setup');
  assert.equal(slugify('---'), '');
});

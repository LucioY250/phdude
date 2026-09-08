import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptedManuscript, planAdaptation } from '../../../src/domain/adapt.js';

const THESIS = {
  schema: 'phdude.profile',
  version: 1,
  name: 'generic-thesis',
  display: 'Generic thesis',
  document_class: 'report',
  citation_style: 'csl/apa.csl',
  sections: [
    { id: 'abstract', title: 'Abstract', required: true, order: 1 },
    { id: 'introduction', title: 'Introduction', required: true, order: 2, max_words: 6000 },
    { id: 'methods', title: 'Methods', required: true, order: 3, max_words: 8000 },
    { id: 'results', title: 'Results', required: true, order: 4, max_words: 8000 },
    { id: 'discussion', title: 'Discussion', required: true, order: 5, max_words: 8000 },
    { id: 'conclusions', title: 'Conclusions', required: true, order: 6, max_words: 3000 },
  ],
  abstract: { max_words: 500 },
  figures: { formats: ['pdf', 'png'] },
  tables: { style: 'booktabs' },
  references: { style: 'APA 7th edition' },
  writing: { first_person: 'sparing' },
};

const SHORT = {
  schema: 'phdude.profile',
  version: 1,
  name: 'short-report',
  display: 'Short report',
  document_class: 'article',
  citation_style: 'csl/ieee.csl',
  sections: [
    { id: 'abstract', title: 'Abstract', required: true, order: 1 },
    { id: 'introduction', title: 'Introduction', required: true, order: 2, max_words: 40 },
    {
      id: 'approach',
      title: 'Approach',
      required: true,
      order: 3,
      max_words: 40,
      synonyms: ['methods', 'methodology'],
    },
    { id: 'findings', title: 'Results', required: true, order: 4, max_words: 40 },
    { id: 'closing', title: 'Closing', required: false, order: 5, max_words: 20 },
  ],
  abstract: { max_words: 10 },
  figures: { formats: ['pdf'] },
  tables: { style: 'booktabs' },
  references: { style: 'IEEE' },
  writing: {
    first_person: 'never',
    terminology_map: { Figure: 'Fig.', participants: 'subjects' },
  },
};

function section(id, title, extra = {}) {
  return {
    id,
    title,
    file: `manuscript/${id}.md`,
    order: 1,
    status: 'approved',
    hash: null,
    claims: [],
    questions: [],
    ...extra,
  };
}

function manuscriptOf(entries) {
  return {
    schema: 'phdude.manuscript',
    version: 1,
    title: 'Edge scheduling',
    language: 'en',
    voice: { kind: 'consensus' },
    target_profile: 'generic-thesis',
    sections: entries.map((entry, index) => ({ ...entry, order: index + 1 })),
  };
}

const SIX = manuscriptOf([
  section('abstract', 'Abstract'),
  section('introduction', 'Introduction'),
  section('methods', 'Methods'),
  section('results', 'Results'),
  section('discussion', 'Discussion'),
  section('conclusions', 'Conclusions'),
]);

const rowFor = (plan, from) => plan.mapping.find((row) => row.from === from);

test('a section the target lists under the same id maps to itself', () => {
  const plan = planAdaptation(SIX, [], THESIS, SHORT);
  assert.equal(rowFor(plan, 'introduction').to, 'introduction');
  assert.match(rowFor(plan, 'introduction').reason, /same section id/);
});

test('a section the target lists as a synonym maps through the synonym', () => {
  const plan = planAdaptation(SIX, [], THESIS, SHORT);
  assert.equal(rowFor(plan, 'methods').to, 'approach');
  assert.match(rowFor(plan, 'methods').reason, /synonym/);
});

test('a section whose title the target reuses under another id maps by title', () => {
  const plan = planAdaptation(SIX, [], THESIS, SHORT);
  assert.equal(rowFor(plan, 'results').to, 'findings');
  assert.match(rowFor(plan, 'results').reason, /titled "Results"/);
});

test('a section the target has no place for needs a decision', () => {
  const plan = planAdaptation(SIX, [], THESIS, SHORT);
  for (const id of ['discussion', 'conclusions']) {
    assert.equal(rowFor(plan, id).to, null, id);
    assert.match(rowFor(plan, id).reason, /needs decision/, id);
  }
});

test('an explicit synonym outranks a title that matches another target section', () => {
  const venue = {
    ...SHORT,
    sections: [
      { id: 'approach', title: 'Methods', required: true, order: 1 },
      { id: 'protocol', title: 'Protocol', required: true, order: 2, synonyms: ['methods'] },
    ],
  };
  const plan = planAdaptation(manuscriptOf([section('methods', 'Methods')]), [], THESIS, venue);
  assert.equal(rowFor(plan, 'methods').to, 'protocol');
});

test('two manuscript sections cannot claim one target section', () => {
  const venue = {
    ...SHORT,
    sections: [{ id: 'findings', title: 'Results', required: true, order: 1 }],
  };
  const manuscript = manuscriptOf([section('findings', 'Findings'), section('results', 'Results')]);
  const plan = planAdaptation(manuscript, [], THESIS, venue);

  assert.equal(rowFor(plan, 'findings').to, 'findings');
  assert.equal(rowFor(plan, 'results').to, null);
  assert.match(rowFor(plan, 'results').reason, /already taken by findings/);
});

test('a required target section nothing maps to is reported from the target side', () => {
  const plan = planAdaptation(manuscriptOf([section('abstract', 'Abstract')]), [], THESIS, SHORT);
  const rows = plan.mapping.filter((row) => row.from === null);

  assert.deepEqual(
    rows.map((row) => row.to),
    ['introduction', 'approach', 'findings'],
  );
  for (const row of rows) assert.match(row.reason, /nothing in the manuscript/);
});

test('an optional target section nothing maps to is not reported', () => {
  const plan = planAdaptation(SIX, [], THESIS, SHORT);
  assert.equal(
    plan.mapping.some((row) => row.to === 'closing'),
    false,
  );
});

test('the mapping keeps manuscript order, with the target-side rows last', () => {
  const plan = planAdaptation(manuscriptOf([section('abstract', 'Abstract')]), [], THESIS, SHORT);
  assert.deepEqual(
    plan.mapping.map((row) => row.from),
    ['abstract', null, null, null],
  );
});

test('limits report every mapped section that has prose and a target limit', () => {
  const sections = [
    { id: 'introduction', body: 'one two three four five' },
    { id: 'methods', body: Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ') },
  ];
  const plan = planAdaptation(SIX, sections, THESIS, SHORT);

  assert.deepEqual(plan.limits, [
    { section: 'introduction', words: 5, max: 40, delta: -35 },
    { section: 'methods', words: 60, max: 40, delta: 20 },
  ]);
});

test('a section with no prose on disk carries no limit row', () => {
  const plan = planAdaptation(SIX, [], THESIS, SHORT);
  assert.deepEqual(plan.limits, []);
});

test('the abstract is reported once, under its own key, never among the limits', () => {
  const sections = [
    { id: 'abstract', body: 'one two three four five six seven eight nine ten eleven twelve' },
  ];
  const plan = planAdaptation(SIX, sections, THESIS, SHORT);

  assert.deepEqual(plan.abstract, {
    section: 'abstract',
    words: 12,
    from: 500,
    to: 10,
    delta: 2,
  });
  assert.equal(
    plan.limits.some((limit) => limit.section === 'abstract'),
    false,
  );
});

test('a manuscript with no abstract still reports the two limits', () => {
  const plan = planAdaptation(
    manuscriptOf([section('introduction', 'Introduction')]),
    [],
    THESIS,
    SHORT,
  );
  assert.deepEqual(plan.abstract, { section: null, words: null, from: 500, to: 10, delta: null });
});

test('a figure in a format the target does not take is reported with the format to convert to', () => {
  const figures = [
    { id: 'FIG-aaaaaaaaaa', outputs: [{ path: 'figures/out/a.svg', format: 'svg' }] },
    { id: 'FIG-bbbbbbbbbb', outputs: [{ path: 'figures/out/b.pdf', format: 'pdf' }] },
  ];
  const plan = planAdaptation(SIX, [], THESIS, SHORT, { figures });

  assert.deepEqual(plan.figures, [{ id: 'FIG-aaaaaaaaaa', from: 'svg', to: 'pdf' }]);
});

test('a figure that already produces one accepted format is not reported', () => {
  const figures = [
    {
      id: 'FIG-cccccccccc',
      outputs: [
        { path: 'figures/out/c.svg', format: 'svg' },
        { path: 'figures/out/c.pdf', format: 'pdf' },
      ],
    },
  ];
  assert.deepEqual(planAdaptation(SIX, [], THESIS, SHORT, { figures }).figures, []);
});

test('terminology reports the target words that are actually in the prose, with their hits', () => {
  const sections = [
    { id: 'introduction', body: 'Figure 1 shows the participants. Figure 2 shows the rest.' },
    { id: 'results', body: 'The trend in Figure 3 is flat.' },
  ];
  const plan = planAdaptation(SIX, sections, THESIS, SHORT);

  assert.deepEqual(plan.terminology, [
    { from: 'Figure', to: 'Fig.', hits: 3 },
    { from: 'participants', to: 'subjects', hits: 1 },
  ]);
});

test('terminology counts whole words only, and ignores markup and citation keys', () => {
  const sections = [
    { id: 'introduction', body: 'Figures and figurines are not Figure [@Figure2020] `Figure`.' },
  ];
  const plan = planAdaptation(SIX, sections, THESIS, SHORT);
  assert.deepEqual(plan.terminology, [{ from: 'Figure', to: 'Fig.', hits: 1 }]);
});

test('a target with no terminology map reports none', () => {
  const venue = { ...SHORT, writing: { first_person: 'never' } };
  const sections = [{ id: 'introduction', body: 'Figure 1 shows the participants.' }];
  assert.deepEqual(planAdaptation(SIX, sections, THESIS, venue).terminology, []);
});

test('the citation style names the two styles, not the CSL files behind them', () => {
  assert.deepEqual(planAdaptation(SIX, [], THESIS, SHORT).citation_style, {
    from: 'APA 7th edition',
    to: 'IEEE',
  });
});

test('the plan is the same object for the same inputs', () => {
  const sections = [{ id: 'introduction', body: 'Figure 1 shows the participants.' }];
  const figures = [{ id: 'FIG-aaaaaaaaaa', outputs: [{ path: 'a.svg', format: 'svg' }] }];
  assert.deepEqual(
    planAdaptation(SIX, sections, THESIS, SHORT, { figures }),
    planAdaptation(SIX, sections, THESIS, SHORT, { figures }),
  );
});

test('the adapted manuscript targets the venue and puts the mapped sections in its order', () => {
  const plan = planAdaptation(SIX, [], THESIS, SHORT);
  const adapted = adaptedManuscript(SIX, plan, SHORT);

  assert.equal(adapted.target_profile, 'short-report');
  assert.deepEqual(
    adapted.sections.map((entry) => [entry.id, entry.title, entry.order]),
    [
      ['abstract', 'Abstract', 1],
      ['introduction', 'Introduction', 2],
      ['approach', 'Approach', 3],
      ['findings', 'Results', 4],
      ['discussion', 'Discussion', 5],
      ['conclusions', 'Conclusions', 6],
    ],
  );
});

test('the adapted sections reference the same files, so no prose is rewritten', () => {
  const plan = planAdaptation(SIX, [], THESIS, SHORT);
  const adapted = adaptedManuscript(SIX, plan, SHORT);

  assert.deepEqual(
    adapted.sections.map((entry) => entry.file),
    SIX.sections.map((entry) => entry.file),
  );
});

test('a section over the target limit is marked revised and loses its approval', () => {
  const manuscript = manuscriptOf([
    section('introduction', 'Introduction', { approved_by: 'DEC-0123456789' }),
    section('results', 'Results', { approved_by: 'DEC-9876543210' }),
  ]);
  const sections = [
    { id: 'introduction', body: Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ') },
    { id: 'results', body: 'three words here' },
  ];
  const plan = planAdaptation(manuscript, sections, THESIS, SHORT);
  const adapted = adaptedManuscript(manuscript, plan, SHORT);

  const introduction = adapted.sections.find((entry) => entry.id === 'introduction');
  assert.equal(introduction.status, 'revised');
  assert.equal(Object.hasOwn(introduction, 'approved_by'), false);

  const findings = adapted.sections.find((entry) => entry.id === 'findings');
  assert.equal(findings.status, 'approved');
  assert.equal(findings.approved_by, 'DEC-9876543210');
});

test('an abstract over the target limit is marked revised too', () => {
  const manuscript = manuscriptOf([section('abstract', 'Abstract')]);
  const sections = [
    { id: 'abstract', body: 'one two three four five six seven eight nine ten eleven' },
  ];
  const plan = planAdaptation(manuscript, sections, THESIS, SHORT);
  const adapted = adaptedManuscript(manuscript, plan, SHORT);

  assert.equal(adapted.sections[0].status, 'revised');
});

test('a planned section is never marked revised: it has no prose to cut', () => {
  const manuscript = manuscriptOf([section('introduction', 'Introduction', { status: 'planned' })]);
  const plan = planAdaptation(manuscript, [], THESIS, SHORT);
  const adapted = adaptedManuscript(manuscript, plan, SHORT);

  assert.equal(adapted.sections[0].status, 'planned');
});

test('the adapted manuscript keeps the title, language, voice and date', () => {
  const manuscript = { ...SIX, date: '2026-09-01T00:00:00Z' };
  const plan = planAdaptation(manuscript, [], THESIS, SHORT);
  const adapted = adaptedManuscript(manuscript, plan, SHORT);

  assert.equal(adapted.title, 'Edge scheduling');
  assert.equal(adapted.language, 'en');
  assert.deepEqual(adapted.voice, { kind: 'consensus' });
  assert.equal(adapted.date, '2026-09-01T00:00:00Z');
});

test('a manuscript with no date carries none', () => {
  const adapted = adaptedManuscript(SIX, planAdaptation(SIX, [], THESIS, SHORT), SHORT);
  assert.equal(Object.hasOwn(adapted, 'date'), false);
});

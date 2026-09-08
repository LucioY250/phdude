import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_CHECKLISTS,
  assembleReviewContext,
  resolveReviewTarget,
} from '../../../src/domain/context-budget.js';

const SOURCE = {
  id: 'SRC-0123456789',
  title: 'Adoption in SMEs',
  authors: ['Z. Zeta'],
  year: 2020,
};
const EVIDENCE = {
  id: 'EVID-1111111111',
  source: 'SRC-0123456789',
  locator: 'p. 3',
  excerpt: 'Adoption is slow among small firms.',
  strength: 'moderate',
};
const CLAIM = {
  id: 'CLAIM-1111111111',
  schema: 'phdude.claim',
  statement: 'SMEs adopt AI slowly.',
  state: 'supported',
  supported_by: ['EVID-1111111111'],
  questions: ['RQ-1'],
  sections: ['Results'],
};
const METHOD = {
  id: 'METH-1111111111',
  name: 'cross-sectional survey',
  paradigm: 'quantitative',
  design: 'one wave, self-administered',
  sampling: 'convenience',
  instruments: ['adoption questionnaire'],
  analysis: ['descriptive'],
  limitations: [],
  questions: ['RQ-1'],
};
const SECTION = {
  id: 'results',
  title: 'Results',
  file: 'manuscript/results.md',
  order: 4,
  status: 'drafted',
  hash: null,
  claims: ['CLAIM-1111111111'],
  questions: ['RQ-1'],
};

function snapshot(overrides = {}) {
  const base = {
    project: { title: 'A thesis', mode: 'full' },
    manuscript: { title: 'A thesis', language: 'en', sections: [SECTION] },
    sectionBodies: { results: 'Adoption was slow.\n' },
    questions: [{ id: 'RQ-1', text: 'How fast do SMEs adopt AI?' }],
    methods: [METHOD],
    facts: [],
    claims: [CLAIM],
    evidence: [EVIDENCE],
    sources: [SOURCE],
    reviews: [],
    repro: [],
    ...overrides,
  };
  base.graph = base.graph ?? {
    nodes: new Map(
      [...base.claims, ...base.evidence, ...base.sources, ...base.methods].map((o) => [o.id, o]),
    ),
  };
  return base;
}

function contextFor(kind, target, overrides = {}, options = {}) {
  return assembleReviewContext(snapshot(overrides), { kind, target, ...options });
}

test('resolveReviewTarget names the project, a manuscript section and an object', () => {
  const snap = snapshot();
  assert.deepEqual(resolveReviewTarget(snap, 'project'), { kind: 'project', id: 'project' });
  assert.equal(resolveReviewTarget(snap, 'manuscript:results').kind, 'section');
  assert.equal(resolveReviewTarget(snap, 'CLAIM-1111111111').kind, 'entity');
});

test('resolveReviewTarget returns null for a section or an object the workspace does not have', () => {
  const snap = snapshot();
  assert.equal(resolveReviewTarget(snap, 'manuscript:appendix'), null);
  assert.equal(resolveReviewTarget(snap, 'CLAIM-9999999999'), null);
  assert.equal(resolveReviewTarget(snap, 'whatever'), null);
});

test('the review context leads with the instruction and the checklist for its kind', () => {
  const result = contextFor('methodology', 'project');
  assert.match(result.markdown, /^# Review context: methodology/);
  assert.equal(result.included[0].kind, 'instruction');
  assert.equal(result.included[1].kind, 'checklist');
  for (const question of REVIEW_CHECKLISTS.methodology) {
    assert.ok(result.markdown.includes(question), `the checklist asks: ${question}`);
  }
});

test('the instruction records the mode the review is running under', () => {
  const full = contextFor('reviewer2', 'project');
  assert.match(full.markdown, /Review mode: full/);
  const ruthless = contextFor('reviewer2', 'project', {
    project: { title: 'A', mode: 'ruthless' },
  });
  assert.match(ruthless.markdown, /Review mode: ruthless/);
});

test('a methodology review reads the methods before the claims; reviewer2 reads them after', () => {
  const order = (result) => result.included.map((item) => item.kind);
  assert.deepEqual(order(contextFor('methodology', 'project')).slice(0, 6), [
    'instruction',
    'checklist',
    'target',
    'facts',
    'methods',
    'claims',
  ]);
  assert.deepEqual(order(contextFor('reviewer2', 'project')).slice(0, 6), [
    'instruction',
    'checklist',
    'target',
    'facts',
    'claims',
    'methods',
  ]);
});

test('a reproducibility review reads what reproduces before anything else', () => {
  const result = contextFor('reproducibility', 'project', {
    repro: [
      {
        id: 'ANALYSIS-1111111111',
        kind: 'analysis',
        name: 'describe survey',
        status: 'stale',
        reasons: [{ kind: 'changed-input', input: 'DATASET-2222222222' }],
      },
    ],
  });
  const kinds = result.included.map((item) => item.kind);
  assert.ok(kinds.indexOf('repro') < kinds.indexOf('claims'));
  assert.match(result.markdown, /ANALYSIS-1111111111 \(analysis\) describe survey: stale/);
  assert.match(result.markdown, /changed-input DATASET-2222222222/);
});

test('a section review carries the prose under review and only that section’s claims', () => {
  const result = contextFor('reviewer2', 'manuscript:results');
  assert.equal(result.target.kind, 'section');
  assert.match(result.markdown, /Adoption was slow\./);
  assert.match(result.markdown, /CLAIM-1111111111 \(supported\)/);
  assert.match(result.markdown, /EVID-1111111111 \(moderate\) from Adoption in SMEs \(2020\)/);
});

test('a section with no prose yet says so instead of pretending there is text', () => {
  const result = contextFor('reviewer2', 'manuscript:results', { sectionBodies: {} });
  assert.match(result.markdown, /\(no prose written yet\)/);
});

test('an object review renders the object under review', () => {
  const result = contextFor('custom', 'CLAIM-1111111111');
  assert.equal(result.target.kind, 'entity');
  assert.match(result.markdown, /CLAIM-1111111111 \(phdude\.claim\)/);
  assert.match(result.markdown, /- statement: SMEs adopt AI slowly\./);
});

test('the context lists the findings already recorded so a review does not repeat itself', () => {
  const result = contextFor('reviewer2', 'project', {
    reviews: [
      {
        id: 'REVIEW-1111111111',
        kind: 'reviewer2',
        target: 'project',
        severity: 'major',
        message: 'The baseline is never described.',
        status: 'open',
      },
      {
        id: 'REVIEW-2222222222',
        kind: 'reviewer2',
        target: 'project',
        severity: 'minor',
        message: 'A dismissed one.',
        status: 'dismissed',
      },
    ],
  });
  assert.match(result.markdown, /REVIEW-1111111111 \[major\/open\]/);
  assert.ok(!result.markdown.includes('REVIEW-2222222222'), 'a dismissed finding is closed');
});

test('a method with no limitations declared says so rather than showing an empty list', () => {
  const result = contextFor('methodology', 'project');
  assert.match(result.markdown, /- Limitations: \(none declared\)/);
});

test('the budget drops the lowest-priority blocks and reports them, never the instruction', () => {
  const result = contextFor('reviewer2', 'project', {}, { budgetChars: 1 });
  assert.deepEqual(
    result.included.map((item) => item.kind),
    ['instruction', 'checklist'],
    'the instruction and the checklist are the contract, not context',
  );
  assert.deepEqual(
    result.truncated.map((item) => item.kind),
    ['target', 'facts', 'claims', 'methods', 'reviews', 'repro'],
  );
});

test('assembleReviewContext returns null when the target names nothing recorded', () => {
  assert.equal(contextFor('reviewer2', 'manuscript:appendix'), null);
  assert.equal(contextFor('reviewer2', 'CLAIM-9999999999'), null);
});

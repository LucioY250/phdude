import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendNext } from '../../../src/domain/next.js';
import { detectFactConflicts } from '../../../src/domain/conflicts.js';

const created = '2026-09-07T00:00:00Z';
const actor = { researcher: 'test' };

function emptySnapshot(overrides = {}) {
  return {
    project: { title: 'T', fields: [], methods: [], outputs: ['thesis'], mode: 'full' },
    artifacts: [],
    sources: [],
    claims: [],
    evidence: [],
    facts: [],
    results: [],
    questions: [],
    hypotheses: [],
    decisions: [],
    ...overrides,
  };
}

function artifact(id, status, warnings = []) {
  return {
    id,
    schema: 'phdude.artifact',
    version: 1,
    created,
    actor,
    path: `sources/${id}.pdf`,
    paths: [`sources/${id}.pdf`],
    hash: 'a'.repeat(64),
    bytes: 10,
    mime: 'application/pdf',
    kind: 'pdf',
    role: 'unknown',
    extracted: { status, method: '', text_chars: 0, sections: 0, tables: 0, warnings },
    mtime: created,
  };
}

function fact(id, key, value, artifactId, unit = undefined) {
  const from = { artifact: artifactId };
  const obj = {
    id,
    schema: 'phdude.fact',
    version: 1,
    created,
    actor,
    key,
    value,
    from,
    state: 'canonical',
  };
  if (unit !== undefined) obj.unit = unit;
  return obj;
}

function claim(id, { state = 'candidate', supported_by = [], questions = [] } = {}) {
  return {
    id,
    schema: 'phdude.claim',
    version: 1,
    created,
    actor,
    statement: `statement ${id}`,
    kind: 'empirical',
    state,
    supported_by,
    questions,
    sections: [],
  };
}

function evidence(id, source) {
  return {
    id,
    schema: 'phdude.evidence',
    version: 1,
    created,
    actor,
    source,
    locator: '',
    excerpt: `excerpt ${id}`,
    strength: 'moderate',
    state: 'candidate',
  };
}

function question(id) {
  return {
    id,
    schema: 'phdude.question',
    version: 1,
    created,
    actor,
    text: `text ${id}`,
    objectives: [],
    state: 'candidate',
  };
}

test('recommendNext: empty snapshot -> top is no-questions', () => {
  const snapshot = emptySnapshot();
  const actions = recommendNext(snapshot, []);
  assert.equal(actions[0].rule, 'no-questions');
  assert.equal(actions[0].impact, 'high');
  assert.ok(actions[0].why.length > 0);
  assert.equal(actions.at(-1).rule, 'consistent');
});

test('recommendNext: RQ present + one unavailable artifact -> rule 2 top, hint in why', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    artifacts: [
      artifact('ART-aaaaaaaaaa', 'unavailable', [
        'pdftotext parser unavailable: install poppler-utils',
      ]),
    ],
  });
  const actions = recommendNext(snapshot, []);
  assert.equal(actions[0].rule, 'extraction-unavailable');
  assert.equal(actions[0].impact, 'high');
  assert.ok(
    actions[0].why.some((w) => w.includes('install poppler-utils')),
    'why should include the install hint from the artifact warning',
  );
});

test('recommendNext: conflict with 3 dependent claims outranks unsupported-claims with 1 dependent', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b'),
  ];
  const conflicts = detectFactConflicts(facts, []);
  assert.equal(conflicts.length, 1);

  const ev1 = evidence('EVID-0000000001', 'ART-a');
  const ev2 = evidence('EVID-0000000002', 'ART-a');
  const ev3 = evidence('EVID-0000000003', 'ART-b');

  const dependentClaims = [
    claim('CLAIM-0000000001', { state: 'candidate', supported_by: [ev1.id] }),
    claim('CLAIM-0000000002', { state: 'candidate', supported_by: [ev2.id] }),
    claim('CLAIM-0000000003', { state: 'candidate', supported_by: [ev3.id] }),
  ];
  const unsupportedClaim = claim('CLAIM-0000000004', { state: 'supported', supported_by: [] });

  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    artifacts: [artifact('ART-a', 'ok'), artifact('ART-b', 'ok')],
    facts,
    evidence: [ev1, ev2, ev3],
    claims: [...dependentClaims, unsupportedClaim],
  });

  const actions = recommendNext(snapshot, conflicts);
  const openConflictAction = actions.find((a) => a.rule === 'open-conflicts');
  const unsupportedAction = actions.find((a) => a.rule === 'unsupported-claims');

  assert.ok(openConflictAction);
  assert.ok(unsupportedAction);
  assert.equal(openConflictAction.dependents, 3);
  assert.equal(unsupportedAction.dependents, 1);
  assert.equal(actions[0].rule, 'open-conflicts');
  assert.ok(actions.indexOf(openConflictAction) < actions.indexOf(unsupportedAction));
});

test('recommendNext: fully consistent workspace -> only consistent action', () => {
  const rq = question('RQ-1');
  const addressingClaim = claim('CLAIM-0000000001', {
    state: 'supported',
    supported_by: ['EVID-0000000001'],
    questions: [rq.id],
  });
  const ev = evidence('EVID-0000000001', 'ART-a');
  const art = artifact('ART-a', 'ok');
  art.role = 'paper';

  const snapshot = emptySnapshot({
    questions: [rq],
    claims: [addressingClaim],
    evidence: [ev],
    artifacts: [art],
  });

  const actions = recommendNext(snapshot, []);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].rule, 'consistent');
  assert.equal(actions[0].impact, 'low');
  assert.ok(actions[0].why.length > 0);
});

test('recommendNext: every action has non-empty why, valid impact, string command, numeric dependents', () => {
  const snapshot = emptySnapshot({
    questions: [],
    artifacts: [artifact('ART-a', 'failed', ['boom'])],
    claims: [claim('CLAIM-0000000001', { state: 'canonical', supported_by: [] })],
  });
  const actions = recommendNext(snapshot, []);
  for (const a of actions) {
    assert.ok(Array.isArray(a.why) && a.why.length > 0, `${a.rule} why must be non-empty`);
    assert.ok(['high', 'medium', 'low'].includes(a.impact));
    assert.equal(typeof a.command, 'string');
    assert.equal(typeof a.dependents, 'number');
  }
});

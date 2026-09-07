import test from 'node:test';
import assert from 'node:assert/strict';
import { findGaps } from '../../../src/domain/gaps.js';
import { detectFactConflicts } from '../../../src/domain/conflicts.js';
import { markContradiction } from '../../../src/domain/contradictions.js';

const created = '2026-09-07T00:00:00Z';
const NOW = '2026-09-07T12:00:00Z';
const actor = { researcher: 'test' };

function question(id, overrides = {}) {
  return {
    id,
    schema: 'phdude.question',
    version: 1,
    created,
    actor,
    text: `text ${id}`,
    objectives: [],
    state: 'candidate',
    ...overrides,
  };
}

function hypothesis(id, questions = []) {
  return {
    id,
    schema: 'phdude.hypothesis',
    version: 1,
    created,
    actor,
    text: `text ${id}`,
    questions,
    state: 'candidate',
  };
}

function method(id, questions = []) {
  return {
    id,
    schema: 'phdude.method',
    version: 1,
    created,
    actor,
    name: `method ${id}`,
    design: 'design',
    paradigm: 'quantitative',
    questions,
    state: 'candidate',
  };
}

function claim(id, { state = 'candidate', supported_by = [], questions = [], contradicts } = {}) {
  const obj = {
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
  if (contradicts) obj.contradicts = contradicts;
  return obj;
}

function evidence(id, source, strength = 'moderate') {
  return {
    id,
    schema: 'phdude.evidence',
    version: 1,
    created,
    actor,
    source,
    locator: '',
    excerpt: `excerpt ${id}`,
    strength,
    state: 'candidate',
  };
}

function source(id, artifacts = []) {
  return {
    id,
    schema: 'phdude.source',
    version: 1,
    created,
    actor,
    title: `Title ${id}`,
    authors: ['A. One'],
    year: 2020,
    type: 'article',
    artifacts,
    state: 'candidate',
  };
}

function artifact(id, role = 'unknown') {
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
    role,
    extracted: { status: 'ok', method: '', text_chars: 1, sections: 0, tables: 0, warnings: [] },
    mtime: created,
  };
}

function fact(id, artifactId) {
  return {
    id,
    schema: 'phdude.fact',
    version: 1,
    created,
    actor,
    key: 'sample_size',
    value: 10,
    from: { artifact: artifactId },
    state: 'candidate',
  };
}

function search(id, questionId, lastRun = '2026-09-01T00:00:00Z') {
  return {
    id,
    schema: 'phdude.search',
    version: 1,
    created,
    actor,
    question: questionId,
    last_run: lastRun,
  };
}

function snapshot(overrides = {}) {
  return {
    questions: [],
    claims: [],
    evidence: [],
    methods: [],
    hypotheses: [],
    sources: [],
    artifacts: [],
    facts: [],
    searches: [],
    decisions: [],
    now: NOW,
    staleAfterDays: 180,
    ...overrides,
  };
}

test('findGaps: question-without-claims fires for a research question no claim addresses (high)', () => {
  const gaps = findGaps(snapshot({ questions: [question('RQ-1')] }), []);
  const gap = gaps.find((g) => g.kind === 'question-without-claims');
  assert.ok(gap);
  assert.equal(gap.id, 'RQ-1');
  assert.equal(gap.severity, 'high');
  assert.match(gap.why, /RQ-1/);
  assert.match(gap.command, /RQ-1/);
});

test('findGaps: question-without-claims does not fire when a claim addresses the question', () => {
  const rq = question('RQ-1');
  const c = claim('CLAIM-a', { questions: ['RQ-1'] });
  const gaps = findGaps(snapshot({ questions: [rq], claims: [c] }), []);
  assert.ok(!gaps.some((g) => g.kind === 'question-without-claims'));
});

test('findGaps: question-only-candidates fires when every addressing claim is still candidate (medium)', () => {
  const rq = question('RQ-1');
  const c1 = claim('CLAIM-a', { questions: ['RQ-1'], state: 'candidate' });
  const c2 = claim('CLAIM-b', { questions: ['RQ-1'], state: 'candidate' });
  const gaps = findGaps(snapshot({ questions: [rq], claims: [c1, c2] }), []);
  const gap = gaps.find((g) => g.kind === 'question-only-candidates');
  assert.ok(gap);
  assert.equal(gap.id, 'RQ-1');
  assert.equal(gap.severity, 'medium');
  assert.match(gap.why, /CLAIM-a/);
  assert.match(gap.why, /CLAIM-b/);
});

test('findGaps: question-only-candidates does not fire once one addressing claim is supported', () => {
  const rq = question('RQ-1');
  const c1 = claim('CLAIM-a', { questions: ['RQ-1'], state: 'supported' });
  const c2 = claim('CLAIM-b', { questions: ['RQ-1'], state: 'candidate' });
  const gaps = findGaps(snapshot({ questions: [rq], claims: [c1, c2] }), []);
  assert.ok(!gaps.some((g) => g.kind === 'question-only-candidates'));
});

test('findGaps: question-without-claims and question-only-candidates are mutually exclusive for the same question', () => {
  const rq = question('RQ-1');
  const gaps = findGaps(snapshot({ questions: [rq] }), []);
  const kinds = gaps.filter((g) => g.id === 'RQ-1').map((g) => g.kind);
  assert.ok(
    !(kinds.includes('question-without-claims') && kinds.includes('question-only-candidates')),
  );
});

test('findGaps: question-without-method fires when no method addresses the question (medium)', () => {
  const rq = question('RQ-1');
  const gaps = findGaps(snapshot({ questions: [rq] }), []);
  const gap = gaps.find((g) => g.kind === 'question-without-method');
  assert.ok(gap);
  assert.equal(gap.id, 'RQ-1');
  assert.equal(gap.severity, 'medium');
});

test('findGaps: question-without-method does not fire once a method addresses the question', () => {
  const rq = question('RQ-1');
  const m = method('METH-a', ['RQ-1']);
  const gaps = findGaps(snapshot({ questions: [rq], methods: [m] }), []);
  assert.ok(!gaps.some((g) => g.kind === 'question-without-method'));
});

test('findGaps: claim-without-evidence fires for a non-rejected claim with empty supported_by (high)', () => {
  const c = claim('CLAIM-a', { state: 'candidate', supported_by: [] });
  const gaps = findGaps(snapshot({ claims: [c] }), []);
  const gap = gaps.find((g) => g.kind === 'claim-without-evidence');
  assert.ok(gap);
  assert.equal(gap.id, 'CLAIM-a');
  assert.equal(gap.severity, 'high');
});

test('findGaps: claim-without-evidence does not fire for a rejected claim', () => {
  const c = claim('CLAIM-a', { state: 'rejected', supported_by: [] });
  const gaps = findGaps(snapshot({ claims: [c] }), []);
  assert.ok(!gaps.some((g) => g.kind === 'claim-without-evidence'));
});

test('findGaps: claim-weak-evidence fires when every evidence item supporting the claim is weak (medium)', () => {
  const ev = evidence('EVID-a', 'SRC-a', 'weak');
  const c = claim('CLAIM-a', { supported_by: ['EVID-a'] });
  const gaps = findGaps(snapshot({ claims: [c], evidence: [ev] }), []);
  const gap = gaps.find((g) => g.kind === 'claim-weak-evidence');
  assert.ok(gap);
  assert.equal(gap.id, 'CLAIM-a');
  assert.equal(gap.severity, 'medium');
});

test('findGaps: claim-weak-evidence does not fire when at least one evidence item is not weak', () => {
  const ev1 = evidence('EVID-a', 'SRC-a', 'weak');
  const ev2 = evidence('EVID-b', 'SRC-a', 'moderate');
  const c = claim('CLAIM-a', { supported_by: ['EVID-a', 'EVID-b'] });
  const gaps = findGaps(snapshot({ claims: [c], evidence: [ev1, ev2] }), []);
  assert.ok(!gaps.some((g) => g.kind === 'claim-weak-evidence'));
});

test('findGaps: hypothesis-untested fires when no claim addresses any of its questions (medium)', () => {
  const h = hypothesis('H-1', ['RQ-1']);
  const gaps = findGaps(snapshot({ hypotheses: [h] }), []);
  const gap = gaps.find((g) => g.kind === 'hypothesis-untested');
  assert.ok(gap);
  assert.equal(gap.id, 'H-1');
  assert.equal(gap.severity, 'medium');
});

test('findGaps: hypothesis-untested does not fire once a claim addresses one of its questions', () => {
  const h = hypothesis('H-1', ['RQ-1']);
  const c = claim('CLAIM-a', { questions: ['RQ-1'] });
  const gaps = findGaps(snapshot({ hypotheses: [h], claims: [c] }), []);
  assert.ok(!gaps.some((g) => g.kind === 'hypothesis-untested'));
});

test('findGaps: uncited-source fires when no evidence cites the source id directly (low)', () => {
  const s = source('SRC-a');
  const gaps = findGaps(snapshot({ sources: [s] }), []);
  const gap = gaps.find((g) => g.kind === 'uncited-source');
  assert.ok(gap);
  assert.equal(gap.id, 'SRC-a');
  assert.equal(gap.severity, 'low');
});

test('findGaps: uncited-source does not fire once evidence cites the source id directly', () => {
  const s = source('SRC-a');
  const ev = evidence('EVID-a', 'SRC-a');
  const gaps = findGaps(snapshot({ sources: [s], evidence: [ev] }), []);
  assert.ok(!gaps.some((g) => g.kind === 'uncited-source'));
});

test('findGaps: artifact-unmined fires for a classified artifact referenced by nothing (low)', () => {
  const a = artifact('ART-a', 'paper');
  const gaps = findGaps(snapshot({ artifacts: [a] }), []);
  const gap = gaps.find((g) => g.kind === 'artifact-unmined');
  assert.ok(gap);
  assert.equal(gap.id, 'ART-a');
  assert.equal(gap.severity, 'low');
});

test('findGaps: artifact-unmined does not fire while role is unknown', () => {
  const a = artifact('ART-a', 'unknown');
  const gaps = findGaps(snapshot({ artifacts: [a] }), []);
  assert.ok(!gaps.some((g) => g.kind === 'artifact-unmined'));
});

test('findGaps: artifact-unmined does not fire once a source references the artifact', () => {
  const a = artifact('ART-a', 'paper');
  const s = source('SRC-a', ['ART-a']);
  const gaps = findGaps(snapshot({ artifacts: [a], sources: [s] }), []);
  assert.ok(!gaps.some((g) => g.kind === 'artifact-unmined'));
});

test('findGaps: artifact-unmined does not fire once a fact references the artifact', () => {
  const a = artifact('ART-a', 'dataset');
  const f = fact('FACT-a', 'ART-a');
  const gaps = findGaps(snapshot({ artifacts: [a], facts: [f] }), []);
  assert.ok(!gaps.some((g) => g.kind === 'artifact-unmined'));
});

test('findGaps: artifact-unmined does not fire once evidence cites the artifact directly', () => {
  const a = artifact('ART-a', 'paper');
  const ev = evidence('EVID-a', 'ART-a');
  const gaps = findGaps(snapshot({ artifacts: [a], evidence: [ev] }), []);
  assert.ok(!gaps.some((g) => g.kind === 'artifact-unmined'));
});

test('findGaps: open-conflict fires once per open conflict key (high)', () => {
  const facts = [fact('FACT-a', 'ART-a'), { ...fact('FACT-b', 'ART-b'), value: 20 }];
  const conflicts = detectFactConflicts(facts, []);
  const gaps = findGaps(snapshot({ facts }), conflicts);
  const gap = gaps.find((g) => g.kind === 'open-conflict');
  assert.ok(gap);
  assert.equal(gap.id, 'sample_size');
  assert.equal(gap.severity, 'high');
});

test('findGaps: open-conflict does not fire for a resolved conflict', () => {
  const facts = [fact('FACT-a', 'ART-a'), { ...fact('FACT-b', 'ART-b'), value: 20 }];
  const decision = {
    id: 'DEC-a',
    status: 'approved',
    change: { fact_key: 'sample_size', canonical_value: 10 },
    affects: ['FACT-a', 'FACT-b'],
  };
  const conflicts = detectFactConflicts(facts, [decision]);
  const gaps = findGaps(snapshot({ facts, decisions: [decision] }), conflicts);
  assert.ok(!gaps.some((g) => g.kind === 'open-conflict'));
});

test('findGaps: disputed-pair fires once per pair with at least one side still disputed (high)', () => {
  const a = claim('CLAIM-a', { state: 'candidate' });
  const b = claim('CLAIM-b', { state: 'candidate' });
  const { a: nextA, b: nextB } = markContradiction(a, b);
  const gaps = findGaps(snapshot({ claims: [nextA, nextB] }), []);
  const gap = gaps.find((g) => g.kind === 'disputed-pair');
  assert.ok(gap);
  assert.match(gap.id, /CLAIM-a/);
  assert.match(gap.id, /CLAIM-b/);
  assert.equal(gap.severity, 'high');
});

test('findGaps: sorted by severity (high, medium, low), then kind, then id', () => {
  const gaps = findGaps(
    snapshot({
      questions: [question('RQ-1')],
      sources: [source('SRC-a')],
    }),
    [],
  );
  const severities = gaps.map((g) => g.severity);
  const rank = { high: 0, medium: 1, low: 2 };
  for (let i = 1; i < severities.length; i++) {
    assert.ok(rank[severities[i - 1]] <= rank[severities[i]], 'severity must be non-decreasing');
  }
});

test('findGaps: is pure - does not mutate its inputs', () => {
  const rq = question('RQ-1');
  const before = JSON.stringify(rq);
  findGaps(snapshot({ questions: [rq] }), []);
  assert.equal(JSON.stringify(rq), before);
});

test('findGaps: question-never-searched fires for a question no search is tied to (medium)', () => {
  const gaps = findGaps(snapshot({ questions: [question('RQ-1')] }), []);
  const gap = gaps.find((g) => g.kind === 'question-never-searched');

  assert.ok(gap);
  assert.equal(gap.id, 'RQ-1');
  assert.equal(gap.severity, 'medium');
  assert.match(gap.why, /never been searched/);
  assert.equal(gap.command, `phdude research "text RQ-1" --question RQ-1`);
});

test('findGaps: question-never-searched does not fire once a search is tied to the question', () => {
  const gaps = findGaps(
    snapshot({ questions: [question('RQ-1')], searches: [search('SEARCH-1', 'RQ-1')] }),
    [],
  );
  assert.ok(!gaps.some((g) => g.kind === 'question-never-searched'));
});

test('findGaps: a search tied to no question leaves the question never-searched', () => {
  const gaps = findGaps(
    snapshot({ questions: [question('RQ-1')], searches: [search('SEARCH-1', null)] }),
    [],
  );
  assert.ok(gaps.some((g) => g.kind === 'question-never-searched'));
});

test('findGaps: stale-search fires once the newest search has aged past the policy (low)', () => {
  const gaps = findGaps(
    snapshot({
      questions: [question('RQ-1')],
      searches: [search('SEARCH-1', 'RQ-1', '2026-01-01T12:00:00Z')],
    }),
    [],
  );
  const gap = gaps.find((g) => g.kind === 'stale-search');

  assert.ok(gap);
  assert.equal(gap.id, 'RQ-1');
  assert.equal(gap.severity, 'low');
  assert.match(gap.why, /249 day\(s\) ago \(stale after 180\)/);
  assert.equal(gap.command, 'phdude research-fresh --question RQ-1');
});

test('findGaps: stale-search and question-never-searched never fire for the same question', () => {
  const gaps = findGaps(
    snapshot({
      questions: [question('RQ-1')],
      searches: [search('SEARCH-1', 'RQ-1', '2026-01-01T12:00:00Z')],
    }),
    [],
  );
  assert.ok(!gaps.some((g) => g.kind === 'question-never-searched'));
});

test('findGaps: the staleness threshold comes from the snapshot, not a constant', () => {
  const searches = [search('SEARCH-1', 'RQ-1', '2026-08-01T12:00:00Z')];
  const strict = findGaps(
    snapshot({ questions: [question('RQ-1')], searches, staleAfterDays: 30 }),
    [],
  );
  const lenient = findGaps(
    snapshot({ questions: [question('RQ-1')], searches, staleAfterDays: 90 }),
    [],
  );

  assert.ok(
    strict.some((g) => g.kind === 'stale-search'),
    '37 days is stale after 30',
  );
  assert.ok(!lenient.some((g) => g.kind === 'stale-search'), '37 days is fresh after 90');
});

test('findGaps: a closed network policy drops question-never-searched to low and opens it first', () => {
  const gaps = findGaps(snapshot({ questions: [question('RQ-1')], networkEnabled: false }), []);
  const gap = gaps.find((g) => g.kind === 'question-never-searched');

  assert.ok(gap);
  assert.equal(gap.severity, 'low');
  assert.equal(
    gap.command,
    'set network.enabled: true in .phdude/research-policy.yaml, then phdude research "text RQ-1" --question RQ-1',
  );
});

test('findGaps: an open network policy leaves question-never-searched at medium', () => {
  const gaps = findGaps(snapshot({ questions: [question('RQ-1')], networkEnabled: true }), []);
  const gap = gaps.find((g) => g.kind === 'question-never-searched');

  assert.equal(gap.severity, 'medium');
  assert.equal(gap.command, `phdude research "text RQ-1" --question RQ-1`);
});

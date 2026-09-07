import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatrix } from '../../../src/domain/matrix.js';

const created = '2026-09-07T00:00:00Z';
const actor = { researcher: 'test' };

function source(
  id,
  {
    authors = ['A. One'],
    year = 2020,
    title = 'A Study',
    type = 'article',
    artifacts = [],
    ext,
  } = {},
) {
  const obj = {
    id,
    schema: 'phdude.source',
    version: 1,
    created,
    actor,
    title,
    authors,
    year,
    type,
    artifacts,
    state: 'candidate',
  };
  if (ext !== undefined) obj.ext = ext;
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

function claim(id, { supported_by = [], questions = [] } = {}) {
  return {
    id,
    schema: 'phdude.claim',
    version: 1,
    created,
    actor,
    statement: `statement ${id}`,
    kind: 'empirical',
    state: 'candidate',
    supported_by,
    questions,
    sections: [],
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

function snapshot(overrides = {}) {
  return { sources: [], evidence: [], claims: [], facts: [], ...overrides };
}

test('buildMatrix: a source cited by evidence supporting a claim reaches the claim question', () => {
  const s = source('SRC-a');
  const ev = evidence('EVID-a', 'SRC-a', 'strong');
  const c = claim('CLAIM-a', { supported_by: ['EVID-a'], questions: ['RQ-1'] });
  const keys = new Map([['SRC-a', 'one2020study']]);

  const rows = buildMatrix(snapshot({ sources: [s], evidence: [ev], claims: [c] }), { keys });

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    id: 'SRC-a',
    bibkey: 'one2020study',
    year: 2020,
    type: 'article',
    authors: ['A. One'],
    title: 'A Study',
    questions: ['RQ-1'],
    claims: ['CLAIM-a'],
    claimCount: 1,
    strongestEvidence: 'strong',
    facts: [],
    methods: [],
    cited: true,
  });
});

test('buildMatrix: evidence citing a source with no claim referencing it leaves questions empty', () => {
  const s = source('SRC-a');
  const ev = evidence('EVID-a', 'SRC-a', 'weak');
  const keys = new Map([['SRC-a', 'one2020study']]);

  const rows = buildMatrix(snapshot({ sources: [s], evidence: [ev] }), { keys });

  assert.equal(rows[0].questions.length, 0);
  assert.equal(rows[0].claims.length, 0);
  assert.equal(rows[0].claimCount, 0);
  assert.equal(rows[0].strongestEvidence, 'weak');
  assert.equal(rows[0].cited, true);
});

test('buildMatrix: a source with no evidence citing it directly is not cited, strongestEvidence is null', () => {
  const s = source('SRC-a');
  const keys = new Map([['SRC-a', 'one2020study']]);

  const rows = buildMatrix(snapshot({ sources: [s] }), { keys });

  assert.equal(rows[0].cited, false);
  assert.equal(rows[0].strongestEvidence, null);
});

test('buildMatrix: evidence citing an artifact (not the source id) does not count as citing the source', () => {
  const s = source('SRC-a', { artifacts: ['ART-a'] });
  const ev = evidence('EVID-a', 'ART-a', 'strong');
  const keys = new Map([['SRC-a', 'one2020study']]);

  const rows = buildMatrix(snapshot({ sources: [s], evidence: [ev] }), { keys });

  assert.equal(rows[0].cited, false);
  assert.equal(rows[0].strongestEvidence, null);
});

test('buildMatrix: strongestEvidence picks strong over moderate/weak/unknown', () => {
  const s = source('SRC-a');
  const evs = [
    evidence('EVID-a', 'SRC-a', 'weak'),
    evidence('EVID-b', 'SRC-a', 'unknown'),
    evidence('EVID-c', 'SRC-a', 'moderate'),
    evidence('EVID-d', 'SRC-a', 'strong'),
  ];
  const keys = new Map([['SRC-a', 'one2020study']]);

  const rows = buildMatrix(snapshot({ sources: [s], evidence: evs }), { keys });
  assert.equal(rows[0].strongestEvidence, 'strong');
});

test('buildMatrix: facts are those whose from.artifact is one of the source artifacts', () => {
  const s = source('SRC-a', { artifacts: ['ART-a', 'ART-b'] });
  const facts = [fact('FACT-a', 'ART-a'), fact('FACT-b', 'ART-b'), fact('FACT-c', 'ART-c')];
  const keys = new Map([['SRC-a', 'one2020study']]);

  const rows = buildMatrix(snapshot({ sources: [s], facts }), { keys });
  assert.deepEqual(rows[0].facts, ['FACT-a', 'FACT-b']);
});

test('buildMatrix: methods come from ext.<pack>.methods across every pack key, flattened and sorted by pack', () => {
  const s = source('SRC-a', {
    ext: { qualitative: { methods: ['interview'] }, quantitative: { methods: ['survey'] } },
  });
  const keys = new Map([['SRC-a', 'one2020study']]);

  const rows = buildMatrix(snapshot({ sources: [s] }), { keys });
  assert.deepEqual(rows[0].methods, ['interview', 'survey']);
});

test('buildMatrix: a source with no ext.<pack>.methods gets an empty methods array', () => {
  const s = source('SRC-a', { ext: { qualitative: {} } });
  const keys = new Map([['SRC-a', 'one2020study']]);

  const rows = buildMatrix(snapshot({ sources: [s] }), { keys });
  assert.deepEqual(rows[0].methods, []);
});

test('buildMatrix: orders by year desc, unknown year last, then bibkey', () => {
  // SRC-b is built without the source() helper: passing `year: undefined` through a
  // destructuring default would resolve to the helper's default year, not "no year".
  const sourceWithNoYear = {
    id: 'SRC-b',
    schema: 'phdude.source',
    version: 1,
    created,
    actor,
    title: 'Study U',
    authors: ['A. One'],
    type: 'article',
    artifacts: [],
    state: 'candidate',
  };
  const sources = [
    source('SRC-a', { year: 2020, title: 'Study Z' }),
    sourceWithNoYear,
    source('SRC-c', { year: 2022, title: 'Study Y' }),
    source('SRC-d', { year: 2020, title: 'Study A' }),
  ];
  const keys = new Map([
    ['SRC-a', 'z2020study'],
    ['SRC-b', 'undated'],
    ['SRC-c', 'y2022study'],
    ['SRC-d', 'a2020study'],
  ]);

  const rows = buildMatrix(snapshot({ sources }), { keys });
  assert.deepEqual(
    rows.map((r) => r.id),
    ['SRC-c', 'SRC-d', 'SRC-a', 'SRC-b'],
  );
});

test('buildMatrix: --question filter keeps only rows whose questions include it', () => {
  const s1 = source('SRC-a');
  const s2 = source('SRC-b', { year: 2021, title: 'Other Study' });
  const ev1 = evidence('EVID-a', 'SRC-a');
  const ev2 = evidence('EVID-b', 'SRC-b');
  const c1 = claim('CLAIM-a', { supported_by: ['EVID-a'], questions: ['RQ-1'] });
  const c2 = claim('CLAIM-b', { supported_by: ['EVID-b'], questions: ['RQ-2'] });
  const keys = new Map([
    ['SRC-a', 'one2020a'],
    ['SRC-b', 'one2021b'],
  ]);

  const rows = buildMatrix(
    snapshot({ sources: [s1, s2], evidence: [ev1, ev2], claims: [c1, c2] }),
    { keys, question: 'RQ-1' },
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ['SRC-a'],
  );
});

test('buildMatrix: is pure - does not mutate its input', () => {
  const s = source('SRC-a');
  const before = JSON.stringify(s);
  buildMatrix(snapshot({ sources: [s] }), { keys: new Map([['SRC-a', 'k']]) });
  assert.equal(JSON.stringify(s), before);
});

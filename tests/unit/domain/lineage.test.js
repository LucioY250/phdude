import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, trace } from '../../../src/domain/lineage.js';

const actor = { researcher: 'test' };
const created = '2026-09-07T00:00:00Z';

const art = {
  schema: 'phdude.artifact',
  version: 1,
  id: 'ART-1111111111',
  created,
  actor,
  path: 'x.pdf',
  paths: ['x.pdf'],
  hash: 'a'.repeat(64),
  bytes: 1,
  mime: 'application/pdf',
  kind: 'pdf',
  role: 'unknown',
  extracted: {
    status: 'unavailable',
    method: '',
    text_chars: 0,
    sections: 0,
    tables: 0,
    warnings: [],
  },
  mtime: created,
};
const src = {
  schema: 'phdude.source',
  version: 1,
  id: 'SRC-2222222222',
  created,
  actor,
  title: 'A Study',
  authors: [],
  type: 'article',
  artifacts: ['ART-1111111111'],
  state: 'candidate',
};
const evid = {
  schema: 'phdude.evidence',
  version: 1,
  id: 'EVID-3333333333',
  created,
  actor,
  source: 'SRC-2222222222',
  locator: '',
  excerpt: 'x',
  strength: 'unknown',
  state: 'candidate',
};
const claim = {
  schema: 'phdude.claim',
  version: 1,
  id: 'CLAIM-4444444444',
  created,
  actor,
  statement: 'x',
  kind: 'empirical',
  state: 'candidate',
  supported_by: ['EVID-3333333333'],
  questions: ['RQ-1'],
  sections: [],
};
const rq = {
  schema: 'phdude.question',
  version: 1,
  id: 'RQ-1',
  created,
  actor,
  text: 'x',
  objectives: [],
  state: 'candidate',
};

function chainGraph() {
  return buildGraph([art, src, evid, claim, rq]);
}

test('buildGraph: builds the 5-node chain ART-SRC-EVID-CLAIM-RQ with correct relations', () => {
  const graph = chainGraph();
  assert.equal(graph.nodes.size, 5);
  assert.equal(graph.dangling.length, 0);
  assert.deepEqual(graph.edges.map((e) => e.rel).sort(), [
    'addresses',
    'cites',
    'has_artifact',
    'supported_by',
  ]);
});

test('trace: up from CLAIM reaches EVID, SRC, ART, RQ deterministically', () => {
  const graph = chainGraph();
  const { up } = trace(graph, 'CLAIM-4444444444');
  assert.deepEqual(
    [...up].sort(),
    ['ART-1111111111', 'EVID-3333333333', 'RQ-1', 'SRC-2222222222'].sort(),
  );

  const { up: upAgain } = trace(graph, 'CLAIM-4444444444');
  assert.deepEqual(up, upAgain, 'repeated calls must produce the same order');
});

test('trace: down from ART includes CLAIM transitively', () => {
  const graph = chainGraph();
  const { down } = trace(graph, 'ART-1111111111');
  assert.ok(down.includes('SRC-2222222222'));
  assert.ok(down.includes('EVID-3333333333'));
  assert.ok(down.includes('CLAIM-4444444444'));
  assert.ok(!down.includes('ART-1111111111'), 'must exclude the id itself');
});

test('buildGraph: dangling reference is reported in graph.dangling, not thrown', () => {
  const danglingEvid = { ...evid, id: 'EVID-9999999999', source: 'SRC-0000000000' };
  const graph = buildGraph([danglingEvid]);
  assert.equal(graph.edges.length, 0);
  assert.deepEqual(graph.dangling, [
    { from: 'EVID-9999999999', to: 'SRC-0000000000', rel: 'cites' },
  ]);
});

test('buildGraph: a decision affecting a manuscript section is neither an edge nor dangling', () => {
  const decision = {
    schema: 'phdude.decision',
    version: 1,
    id: 'DEC-1111111111',
    affects: ['manuscript:introduction', 'CLAIM-0000000000'],
  };
  const graph = buildGraph([decision]);
  assert.deepEqual(graph.edges, []);
  assert.deepEqual(graph.dangling, [
    { from: 'DEC-1111111111', to: 'CLAIM-0000000000', rel: 'affects' },
  ]);
});

test('trace: unknown id returns empty up/down', () => {
  const graph = chainGraph();
  assert.deepEqual(trace(graph, 'CLAIM-0000000000'), { up: [], down: [] });
});

const method = {
  schema: 'phdude.method',
  version: 1,
  id: 'METH-5555555555',
  created,
  actor,
  name: 'Cross-sectional survey',
  design: 'One wave, three campuses.',
  paradigm: 'quantitative',
  instruments: [],
  analysis: [],
  limitations: [],
  questions: ['RQ-1'],
  state: 'candidate',
};

test('buildGraph: a method addresses the questions it lists', () => {
  const graph = buildGraph([method, rq]);
  assert.deepEqual(graph.edges, [{ from: 'METH-5555555555', to: 'RQ-1', rel: 'addresses' }]);
  assert.equal(graph.dangling.length, 0);
});

test('trace: a research question traces down to the method that addresses it', () => {
  const graph = buildGraph([art, src, evid, claim, rq, method]);
  assert.ok(trace(graph, 'RQ-1').down.includes('METH-5555555555'));
  assert.deepEqual(trace(graph, 'METH-5555555555').up, ['RQ-1']);
});

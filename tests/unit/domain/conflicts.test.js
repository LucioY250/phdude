import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFactConflicts, openConflicts } from '../../../src/domain/conflicts.js';

const created = '2026-09-07T00:00:00Z';
const actor = { researcher: 'test' };

function fact(
  id,
  key,
  value,
  artifactId,
  unit = undefined,
  locator = undefined,
  state = 'canonical',
) {
  const from = { artifact: artifactId };
  if (locator !== undefined) from.locator = locator;
  const obj = { id, schema: 'phdude.fact', version: 1, created, actor, key, value, from, state };
  if (unit !== undefined) obj.unit = unit;
  return obj;
}

function decision(id, status, factKey, canonicalValue, affects = []) {
  return {
    id,
    schema: 'phdude.decision',
    version: 1,
    created,
    actor,
    title: `Decision ${id}`,
    rationale: 'test',
    proposed_by: actor,
    approved_by: status === 'approved' ? ['test'] : [],
    status,
    change: {
      fact_key: factKey,
      canonical_value: canonicalValue,
    },
    affects,
  };
}

test('detectFactConflicts: PRD §38 example - sample_size 312, 300, 312 from 3 artifacts', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b'),
    fact('FACT-0000000003', 'sample_size', 312, 'ART-c'),
  ];
  const conflicts = detectFactConflicts(facts, []);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].key, 'sample_size');
  assert.equal(conflicts[0].values.length, 3);
  assert.deepEqual(
    new Set(conflicts[0].values.map((v) => String(v.value))),
    new Set(['312', '300']),
  );
  assert.equal(conflicts[0].resolved, null);
});

test('detectFactConflicts: same value from multiple artifacts produces no conflict', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 312, 'ART-b'),
  ];
  const conflicts = detectFactConflicts(facts, []);
  assert.equal(conflicts.length, 0);
});

test('detectFactConflicts: rejected fact is ignored', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b', undefined, undefined, 'rejected'),
    fact('FACT-0000000003', 'sample_size', 312, 'ART-c'),
  ];
  const conflicts = detectFactConflicts(facts, []);
  assert.equal(conflicts.length, 0, 'rejected fact should be ignored');
});

test('detectFactConflicts: two different values from same artifact produce no conflict', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-a'),
  ];
  const conflicts = detectFactConflicts(facts, []);
  assert.equal(conflicts.length, 0, 'same artifact cannot create conflict alone');
});

test('detectFactConflicts: approved decision resolves conflict', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b'),
  ];
  const decisions = [
    decision('DEC-aaaaaaaaaa', 'approved', 'sample_size', 312, [
      'FACT-0000000001',
      'FACT-0000000002',
    ]),
  ];
  const conflicts = detectFactConflicts(facts, decisions);
  assert.equal(conflicts.length, 1);
  assert.ok(conflicts[0].resolved, 'conflict should be resolved');
  assert.equal(conflicts[0].resolved.decision, 'DEC-aaaaaaaaaa');
  assert.equal(conflicts[0].resolved.canonical_value, 312);
});

test('detectFactConflicts: proposed decision does not resolve conflict', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b'),
  ];
  const decisions = [decision('DEC-aaaaaaaaaa', 'proposed', 'sample_size', 312)];
  const conflicts = detectFactConflicts(facts, decisions);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].resolved, null, 'proposed decision should not resolve');
});

test('detectFactConflicts: conflicts sorted by key', () => {
  const facts = [
    fact('FACT-0000000001', 'zebra', 1, 'ART-a'),
    fact('FACT-0000000002', 'zebra', 2, 'ART-b'),
    fact('FACT-0000000003', 'apple', 10, 'ART-c'),
    fact('FACT-0000000004', 'apple', 20, 'ART-d'),
  ];
  const conflicts = detectFactConflicts(facts, []);
  assert.equal(conflicts.length, 2);
  assert.equal(conflicts[0].key, 'apple');
  assert.equal(conflicts[1].key, 'zebra');
});

test('detectFactConflicts: values sorted by factId', () => {
  const facts = [
    fact('FACT-0000000003', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000001', 'sample_size', 300, 'ART-b'),
    fact('FACT-0000000002', 'sample_size', 312, 'ART-c'),
  ];
  const conflicts = detectFactConflicts(facts, []);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(
    conflicts[0].values.map((v) => v.factId),
    ['FACT-0000000001', 'FACT-0000000002', 'FACT-0000000003'],
  );
});

test('detectFactConflicts: unit defaults to null when absent', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b'),
  ];
  const conflicts = detectFactConflicts(facts, []);
  for (const v of conflicts[0].values) {
    assert.equal(v.unit, null);
  }
});

test('detectFactConflicts: locator defaults to null when absent', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b'),
  ];
  const conflicts = detectFactConflicts(facts, []);
  for (const v of conflicts[0].values) {
    assert.equal(v.from.locator, null);
  }
});

test('detectFactConflicts: preserves unit when present', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a', 'people'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b', 'people'),
  ];
  const conflicts = detectFactConflicts(facts, []);
  for (const v of conflicts[0].values) {
    assert.equal(v.unit, 'people');
  }
});

test('detectFactConflicts: preserves locator when present', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a', undefined, 'p. 5'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b', undefined, 'p. 10'),
  ];
  const conflicts = detectFactConflicts(facts, []);
  assert.equal(conflicts[0].values[0].from.locator, 'p. 5');
  assert.equal(conflicts[0].values[1].from.locator, 'p. 10');
});

test('detectFactConflicts: values array includes all non-rejected facts', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 312, 'ART-b'),
    fact('FACT-0000000003', 'sample_size', 300, 'ART-c'),
  ];
  const conflicts = detectFactConflicts(facts, []);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].values.length, 3, 'should include all non-rejected facts');
});

test('detectFactConflicts: first approved decision by id resolves conflict', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b'),
  ];
  const affects = ['FACT-0000000001', 'FACT-0000000002'];
  const decisions = [
    decision('DEC-zzzzzzzzzz', 'approved', 'sample_size', 300, affects),
    decision('DEC-aaaaaaaaaa', 'approved', 'sample_size', 312, affects),
  ];
  const conflicts = detectFactConflicts(facts, decisions);
  assert.equal(conflicts[0].resolved.decision, 'DEC-aaaaaaaaaa', 'should pick first by id');
});

test('openConflicts: filters to unresolved only', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b'),
    fact('FACT-0000000003', 'weight', 10, 'ART-c'),
    fact('FACT-0000000004', 'weight', 20, 'ART-d'),
  ];
  const decisions = [
    decision('DEC-aaaaaaaaaa', 'approved', 'sample_size', 312, [
      'FACT-0000000001',
      'FACT-0000000002',
    ]),
  ];
  const conflicts = detectFactConflicts(facts, decisions);
  const open = openConflicts(conflicts);
  assert.equal(open.length, 1);
  assert.equal(open[0].key, 'weight');
});

test('openConflicts: returns empty when all resolved', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b'),
  ];
  const decisions = [
    decision('DEC-aaaaaaaaaa', 'approved', 'sample_size', 312, [
      'FACT-0000000001',
      'FACT-0000000002',
    ]),
  ];
  const conflicts = detectFactConflicts(facts, decisions);
  const open = openConflicts(conflicts);
  assert.equal(open.length, 0);
});

test('detectFactConflicts: canonical_value null when not provided', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b'),
  ];
  const decisions = [
    decision('DEC-aaaaaaaaaa', 'approved', 'sample_size', undefined, [
      'FACT-0000000001',
      'FACT-0000000002',
    ]),
  ];
  decisions[0].change.canonical_value = undefined;
  const conflicts = detectFactConflicts(facts, decisions);
  assert.equal(conflicts[0].resolved.canonical_value, null);
});

test('detectFactConflicts: distinguishes numeric and string values', () => {
  const facts = [
    fact('FACT-0000000001', 'count', 42, 'ART-a'),
    fact('FACT-0000000002', 'count', '42', 'ART-b'),
  ];
  const conflicts = detectFactConflicts(facts, []);
  assert.equal(conflicts.length, 0, '42 (number) and "42" (string) stringify to same value');
});

test('detectFactConflicts: boolean values work correctly', () => {
  const facts = [
    fact('FACT-0000000001', 'is_peer_reviewed', true, 'ART-a'),
    fact('FACT-0000000002', 'is_peer_reviewed', false, 'ART-b'),
  ];
  const conflicts = detectFactConflicts(facts, []);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(
    new Set(conflicts[0].values.map((v) => String(v.value))),
    new Set(['true', 'false']),
  );
});

test('detectFactConflicts: a fact added after the decision reopens the conflict', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b'),
  ];
  const decisions = [
    decision('DEC-aaaaaaaaaa', 'approved', 'sample_size', 312, [
      'FACT-0000000001',
      'FACT-0000000002',
    ]),
  ];
  assert.ok(detectFactConflicts(facts, decisions)[0].resolved, 'resolved before the new fact');

  const withNewFact = [...facts, fact('FACT-0000000004', 'sample_size', 999, 'ART-d')];
  const conflicts = detectFactConflicts(withNewFact, decisions);
  assert.equal(conflicts.length, 1);
  assert.equal(
    conflicts[0].resolved,
    null,
    'a fact the decision never saw must reopen the conflict',
  );
  assert.equal(openConflicts(conflicts).length, 1);
});

test('detectFactConflicts: a decision covering only some facts does not resolve', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b'),
    fact('FACT-0000000003', 'sample_size', 288, 'ART-c'),
  ];
  const decisions = [
    decision('DEC-aaaaaaaaaa', 'approved', 'sample_size', 312, [
      'FACT-0000000001',
      'FACT-0000000002',
    ]),
  ];
  const conflicts = detectFactConflicts(facts, decisions);
  assert.equal(conflicts[0].resolved, null, 'partial affects coverage must not resolve');
});

test('detectFactConflicts: a rejected fact need not appear in affects', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b'),
    fact('FACT-0000000003', 'sample_size', 288, 'ART-c', undefined, undefined, 'rejected'),
  ];
  const decisions = [
    decision('DEC-aaaaaaaaaa', 'approved', 'sample_size', 312, [
      'FACT-0000000001',
      'FACT-0000000002',
    ]),
  ];
  assert.ok(detectFactConflicts(facts, decisions)[0].resolved);
});

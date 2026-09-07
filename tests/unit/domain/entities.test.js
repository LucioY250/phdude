import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newClaim,
  newEvidence,
  newFact,
  newSource,
  newResult,
  newQuestion,
  newHypothesis,
  newDecision,
} from '../../../src/domain/entities.js';
import { assertValid } from '../../../src/schemas/index.js';
import { PhdudeError } from '../../../src/domain/errors.js';

const actor = { researcher: 'test' };
const created = '2026-09-07T00:00:00Z';

test('newClaim: schema-valid output with defaults', () => {
  const claim = newClaim({ statement: 'AI adoption is rising among SMEs', actor, created });
  assertValid('claim', claim);
  assert.equal(claim.state, 'candidate');
  assert.equal(claim.kind, 'empirical');
  assert.deepEqual(claim.tags, []);
  assert.deepEqual(claim.supported_by, []);
  assert.deepEqual(claim.questions, []);
});

test('newClaim: same statement twice (ignoring surrounding whitespace) yields the same id', () => {
  const a = newClaim({ statement: 'Same statement here', actor, created });
  const b = newClaim({ statement: '  Same statement here  ', actor, created });
  assert.equal(a.id, b.id);
});

test('newClaim: rejects empty statement', () => {
  assert.throws(
    () => newClaim({ statement: '   ', actor, created }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      return true;
    },
  );
});

test('newEvidence: schema-valid output with defaults', () => {
  const evidence = newEvidence({
    source: 'SRC-0000000000',
    locator: 'p. 1',
    excerpt: 'a supporting excerpt',
    actor,
    created,
  });
  assertValid('evidence', evidence);
  assert.equal(evidence.strength, 'unknown');
  assert.equal(evidence.state, 'candidate');
});

test('newEvidence: rejects empty excerpt', () => {
  assert.throws(
    () => newEvidence({ source: 'SRC-0000000000', excerpt: '  ', actor, created }),
    PhdudeError,
  );
});

test('newFact: normalizes key and is schema-valid', () => {
  const fact = newFact({
    key: 'Sample Size',
    value: 312,
    from: { artifact: 'ART-0000000000' },
    actor,
    created,
  });
  assert.equal(fact.key, 'sample_size');
  assertValid('fact', fact);
});

test('newFact: rejects empty key', () => {
  assert.throws(
    () => newFact({ key: '   ', value: 1, from: { artifact: 'ART-0000000000' }, actor, created }),
    PhdudeError,
  );
});

test('newFact: same key+value from two different artifacts get different ids', () => {
  const a = newFact({
    key: 'sample_size',
    value: 312,
    from: { artifact: 'ART-aaaaaaaaaa' },
    actor,
    created,
  });
  const b = newFact({
    key: 'sample_size',
    value: 312,
    from: { artifact: 'ART-bbbbbbbbbb' },
    actor,
    created,
  });
  assert.notEqual(
    a.id,
    b.id,
    'facts about the same key+value from different artifacts must not collide',
  );
  assertValid('fact', a);
  assertValid('fact', b);
});

test('newFact: same key+value+artifact triple yields the same id', () => {
  const a = newFact({
    key: 'sample_size',
    value: 312,
    from: { artifact: 'ART-aaaaaaaaaa' },
    actor,
    created,
  });
  const b = newFact({
    key: 'Sample Size',
    value: 312,
    from: { artifact: 'ART-aaaaaaaaaa' },
    actor,
    created,
  });
  assert.equal(a.id, b.id, 're-adding the identical fact should be idempotent');
});

test('newSource: schema-valid, id derives from title + year', () => {
  const source = newSource({ title: 'A Study of Adoption', year: 2020, actor, created });
  assertValid('source', source);

  const same = newSource({ title: 'A Study of Adoption', year: 2020, actor, created });
  assert.equal(source.id, same.id);

  const differentYear = newSource({ title: 'A Study of Adoption', year: 2021, actor, created });
  assert.notEqual(source.id, differentYear.id);
});

test('newSource: rejects empty title', () => {
  assert.throws(() => newSource({ title: '  ', actor, created }), PhdudeError);
});

test('newResult: schema-valid output with default values', () => {
  const result = newResult({ summary: 'A notable finding', from: 'regression', actor, created });
  assertValid('result', result);
  assert.deepEqual(result.values, {});
  assert.equal(result.state, 'candidate');
});

test('newResult: rejects empty summary', () => {
  assert.throws(
    () => newResult({ summary: '  ', from: 'regression', actor, created }),
    PhdudeError,
  );
});

test('newQuestion: schema-valid, sequential id', () => {
  const q = newQuestion({ n: 1, text: 'What drives adoption?', actor, created });
  assertValid('question', q);
  assert.equal(q.id, 'RQ-1');
});

test('newQuestion: rejects empty text', () => {
  assert.throws(() => newQuestion({ n: 1, text: '  ', actor, created }), PhdudeError);
});

test('newHypothesis: schema-valid, sequential id', () => {
  const h = newHypothesis({
    n: 1,
    text: 'Firm size moderates adoption',
    questions: ['RQ-1'],
    actor,
    created,
  });
  assertValid('hypothesis', h);
  assert.equal(h.id, 'H-1');
});

test('newHypothesis: rejects empty text', () => {
  assert.throws(() => newHypothesis({ n: 1, text: '  ', actor, created }), PhdudeError);
});

test('newDecision: schema-valid output with defaults', () => {
  const decision = newDecision({
    title: 'Resolve conflicting sample-size reports',
    rationale: 'Two artifacts disagreed; the methodology section confirms 312.',
    proposed_by: actor,
    affects: ['FACT-0000000000'],
    created,
  });
  assertValid('decision', decision);
  assert.equal(decision.status, 'proposed');
  assert.deepEqual(decision.approved_by, []);
  assert.deepEqual(decision.change, {});
  assert.deepEqual(decision.proposed_by, actor);
});

test('newDecision: rejects empty title', () => {
  assert.throws(
    () =>
      newDecision({
        title: '   ',
        rationale: 'some rationale',
        proposed_by: actor,
        created,
      }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      return true;
    },
  );
});

test('newDecision: rejects empty rationale', () => {
  assert.throws(
    () =>
      newDecision({
        title: 'A title',
        rationale: '   ',
        proposed_by: actor,
        created,
      }),
    PhdudeError,
  );
});

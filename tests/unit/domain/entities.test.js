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
  newMethod,
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

test('newEvidence: identity includes source, locator and excerpt', () => {
  const base = {
    source: 'SRC-0000000000',
    locator: 'p. 4, para 2',
    excerpt: 'Participants numbered 142.',
    actor,
    created,
  };
  assert.equal(newEvidence(base).id, newEvidence({ ...base }).id, 'same content, same id');
  assert.notEqual(
    newEvidence(base).id,
    newEvidence({ ...base, source: 'SRC-1111111111' }).id,
    'a different source is different evidence',
  );
  assert.notEqual(
    newEvidence(base).id,
    newEvidence({ ...base, locator: 'p. 9' }).id,
    'a different locator is different evidence',
  );
  assert.notEqual(
    newEvidence(base).id,
    newEvidence({ ...base, excerpt: 'Participants numbered 151.' }).id,
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

test('newDecision: identity includes rationale, affects and change', () => {
  const base = {
    title: 'Adopt 151 as the canonical sample size',
    rationale: 'The methodology section confirms 151.',
    proposed_by: actor,
    affects: ['FACT-0000000001', 'FACT-0000000002'],
    change: { fact_key: 'sample_size', canonical_value: 151 },
    created,
  };
  assert.equal(newDecision(base).id, newDecision({ ...base }).id, 'same content, same id');
  assert.notEqual(
    newDecision(base).id,
    newDecision({ ...base, rationale: 'A completely different rationale.' }).id,
    'a re-proposal under the same title must not return the old decision',
  );
  assert.notEqual(newDecision(base).id, newDecision({ ...base, affects: ['FACT-0000000001'] }).id);
  assert.notEqual(
    newDecision(base).id,
    newDecision({ ...base, change: { fact_key: 'sample_size', canonical_value: 142 } }).id,
  );
});

test('newDecision: id is stable under affects order and change key order', () => {
  const base = {
    title: 'Adopt 151 as the canonical sample size',
    rationale: 'The methodology section confirms 151.',
    proposed_by: actor,
    created,
  };
  assert.equal(
    newDecision({ ...base, affects: ['FACT-b', 'FACT-a'] }).id,
    newDecision({ ...base, affects: ['FACT-a', 'FACT-b'] }).id,
  );
  assert.equal(
    newDecision({ ...base, change: { canonical_value: 151, fact_key: 'sample_size' } }).id,
    newDecision({ ...base, change: { fact_key: 'sample_size', canonical_value: 151 } }).id,
  );
});

test('newDecision: identity reaches nested values inside change', () => {
  const base = {
    title: 'Record the study metadata',
    rationale: 'The methodology section lists it.',
    proposed_by: actor,
    created,
  };
  assert.notEqual(
    newDecision({ ...base, change: { fact_key: 'k', meta: { a: 1 } } }).id,
    newDecision({ ...base, change: { fact_key: 'k', meta: { b: 2 } } }).id,
    'a nested change value must not be erased from the id material',
  );
  assert.notEqual(
    newDecision({ ...base, change: { meta: { list: [1, 2] } } }).id,
    newDecision({ ...base, change: { meta: { list: [2, 1] } } }).id,
    'array order inside change is content, not ordering noise',
  );
});

test('newDecision: nested change key order does not change the id', () => {
  const base = {
    title: 'Record the study metadata',
    rationale: 'The methodology section lists it.',
    proposed_by: actor,
    created,
  };
  assert.equal(
    newDecision({ ...base, change: { fact_key: 'k', meta: { a: 1, b: { x: 1, y: 2 } } } }).id,
    newDecision({ ...base, change: { meta: { b: { y: 2, x: 1 }, a: 1 }, fact_key: 'k' } }).id,
  );
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

test('newMethod: schema-valid output with defaults', () => {
  const method = newMethod({
    name: 'Cross-sectional survey',
    paradigm: 'quantitative',
    actor,
    created,
  });
  assertValid('method', method);
  assert.match(method.id, /^METH-[0-9a-f]{10}$/);
  assert.equal(method.state, 'candidate');
  assert.equal(method.design, '');
  assert.deepEqual(method.instruments, []);
  assert.deepEqual(method.analysis, []);
  assert.deepEqual(method.limitations, []);
  assert.deepEqual(method.questions, []);
  assert.equal(method.sampling, undefined, 'sampling is omitted when it was not given');
});

test('newMethod: keeps the optional fields it is given', () => {
  const method = newMethod({
    name: 'Semi-structured interviews',
    design: 'Twelve interviews across three faculties.',
    paradigm: 'qualitative',
    sampling: 'purposive',
    instruments: ['interview guide v2'],
    analysis: ['thematic analysis'],
    limitations: ['single institution'],
    questions: ['RQ-1'],
    actor,
    created,
  });
  assertValid('method', method);
  assert.equal(method.sampling, 'purposive');
  assert.deepEqual(method.questions, ['RQ-1']);
});

test('newMethod: the id comes from the normalized name alone', () => {
  const a = newMethod({
    name: 'Cross-Sectional   Survey',
    paradigm: 'quantitative',
    actor,
    created,
  });
  const b = newMethod({
    name: 'cross-sectional survey',
    paradigm: 'mixed',
    design: 'a different design',
    actor,
    created,
  });
  assert.equal(a.id, b.id, 'the name is the whole id material');
  assert.notEqual(
    a.id,
    newMethod({ name: 'Field experiment', paradigm: 'mixed', actor, created }).id,
  );
});

test('newMethod: rejects an empty name', () => {
  assert.throws(
    () => newMethod({ name: '   ', paradigm: 'quantitative', actor, created }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      return true;
    },
  );
});

test('newClaim: provenance defaults to manual when the CLI is the agent', () => {
  const claim = newClaim({
    statement: 'A claim typed by a researcher',
    actor: { researcher: 'ada', agent: 'cli' },
    created,
  });
  assertValid('claim', claim);
  assert.deepEqual(claim.provenance, { method: 'manual', derived_from: [] });
});

test('newClaim: provenance defaults to agent-extraction for any other agent', () => {
  const claim = newClaim({
    statement: 'A claim extracted by an agent',
    actor: { researcher: 'ada', agent: 'claude-code' },
    created,
  });
  assert.equal(claim.provenance.method, 'agent-extraction');
});

test('newClaim: derived_from lands in provenance and an explicit provenance wins', () => {
  const derived = newClaim({
    statement: 'A derived claim',
    derived_from: ['ART-1111111111'],
    actor,
    created,
  });
  assert.deepEqual(derived.provenance.derived_from, ['ART-1111111111']);

  const explicit = newClaim({
    statement: 'An imported claim',
    derived_from: ['ART-1111111111'],
    provenance: { method: 'imported', derived_from: ['ART-2222222222'] },
    actor,
    created,
  });
  assert.deepEqual(explicit.provenance, { method: 'imported', derived_from: ['ART-2222222222'] });
});

test('newEvidence: provenance defaults the same way and stays out of the id material', () => {
  const base = { source: 'SRC-0000000000', excerpt: 'an excerpt', created };
  const manual = newEvidence({ ...base, actor: { researcher: 'ada', agent: 'cli' } });
  const extracted = newEvidence({ ...base, actor: { researcher: 'ada', agent: 'codex' } });

  assertValid('evidence', manual);
  assert.equal(manual.provenance.method, 'manual');
  assert.equal(extracted.provenance.method, 'agent-extraction');
  assert.equal(manual.id, extracted.id, 'provenance is not part of the id');
});

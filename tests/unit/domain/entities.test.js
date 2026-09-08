import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  newDataset,
  newAnalysis,
  newTable,
  newFigure,
  newReview,
} from '../../../src/domain/entities.js';
import { makeId } from '../../../src/domain/ids.js';
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

test('newDataset: schema-valid, id derived from the file hash, candidate by default', () => {
  const hash = 'a'.repeat(64);
  const dataset = newDataset({
    path: 'data/survey.csv',
    hash,
    bytes: 128,
    format: 'csv',
    profile: { rows: 0, columns: [] },
    actor,
    created,
  });
  assertValid('dataset', dataset);
  assert.equal(dataset.id, `DATASET-${'a'.repeat(10)}`);
  assert.equal(dataset.state, 'candidate');
  assert.equal(dataset.sensitive, false);
  assert.equal(Object.hasOwn(dataset, 'description'), false);
  assert.equal(Object.hasOwn(dataset, 'license'), false);
});

test('newDataset: the same bytes at a different path is the same id', () => {
  const base = {
    hash: 'b'.repeat(64),
    bytes: 4,
    format: 'csv',
    profile: { rows: 0, columns: [] },
    actor,
    created,
  };
  assert.equal(
    newDataset({ ...base, path: 'data/a.csv' }).id,
    newDataset({ ...base, path: 'data/b.csv' }).id,
  );
});

test('newDataset: an empty path is refused', () => {
  assert.throws(
    () =>
      newDataset({
        path: '  ',
        hash: 'c'.repeat(64),
        bytes: 0,
        format: 'other',
        profile: { rows: 0, columns: [] },
        actor,
        created,
      }),
    PhdudeError,
  );
});

test('newResult: the analysis it came from is part of the id', () => {
  const base = { summary: 'Mean age is 38.4 years', actor, created };
  const a = newResult({ ...base, from: 'ANALYSIS-0123456789' });
  const b = newResult({ ...base, from: 'ANALYSIS-9999999999' });
  assert.notEqual(a.id, b.id);
  assert.equal(a.id, newResult({ ...base, from: 'ANALYSIS-0123456789' }).id);
});

test('newResult: a result with no `from` keeps the id v0.4 gave it', () => {
  const summary = 'A notable finding';
  const bare = newResult({ summary, from: '', actor, created });
  assert.equal(bare.id, makeId('result', summary));
  assert.equal(newResult({ summary, from: undefined, actor, created }).id, bare.id);
});

test('newResult: a `from` that is not an analysis keeps the v0.4 id', () => {
  const v04 = JSON.parse(
    readFileSync(new URL('../../fixtures/objects/v0.4-result.json', import.meta.url), 'utf8'),
  );
  const readded = newResult({
    summary: v04.summary,
    from: v04.from,
    values: v04.values,
    actor,
    created,
  });
  assert.equal(readded.id, v04.id);
  assert.equal(readded.id, makeId('result', v04.summary));
});

test('newAnalysis: schema-valid, id derived from the name, no runs yet', () => {
  const analysis = newAnalysis({
    name: 'describe survey',
    runtime: 'node',
    script: 'analysis/describe.mjs',
    inputs: ['DATASET-0123456789'],
    outputs: { results: 'analysis/out/describe-survey/results.json', files: [] },
    actor,
    created,
  });

  assertValid('analysis', analysis);
  assert.equal(analysis.id, makeId('analysis', 'describe survey'));
  assert.match(analysis.id, /^ANALYSIS-[0-9a-f]{10}$/);
  assert.deepEqual(analysis.runs, []);
  assert.deepEqual(analysis.args, []);
  assert.deepEqual(analysis.params, {});
  assert.deepEqual(analysis.tags, []);
  assert.equal(analysis.state, 'candidate');
});

test('newAnalysis: the name alone is the identity', () => {
  const outputs = { results: 'analysis/out/x/results.json', files: [] };
  const a = newAnalysis({
    name: 'Describe  Survey',
    runtime: 'node',
    script: 'analysis/a.mjs',
    outputs,
    actor,
    created,
  });
  const b = newAnalysis({
    name: 'describe survey',
    runtime: 'python3',
    script: 'analysis/b.py',
    outputs,
    actor,
    created,
  });
  assert.equal(a.id, b.id);
});

test('newAnalysis: rejects an empty name', () => {
  assert.throws(
    () =>
      newAnalysis({
        name: '  ',
        runtime: 'node',
        script: 'analysis/a.mjs',
        outputs: { results: 'analysis/out/x/results.json', files: [] },
        actor,
        created,
      }),
    PhdudeError,
  );
});

test('newTable: schema-valid, named by its slug, with an output per declared format', () => {
  const table = newTable({
    name: 'mean-weight',
    caption: 'Mean weight by group.',
    source: { result: 'RESULT-0123456789' },
    columns: [{ key: 'key', label: 'Group' }],
    formats: ['csv', 'md'],
    actor,
    created,
  });

  assertValid('table', table);
  assert.match(table.id, /^TABLE-[0-9a-f]{10}$/);
  assert.deepEqual(table.formats, ['md', 'csv']);
  assert.deepEqual(table.outputs, {
    md: 'tables/out/mean-weight.md',
    csv: 'tables/out/mean-weight.csv',
  });
  assert.deepEqual(table.runs, []);
  assert.equal(table.state, 'candidate');
});

test('newTable: the name is the identity, and a bad name or an empty caption is refused', () => {
  const base = {
    caption: 'Mean weight by group.',
    source: { result: 'RESULT-0123456789' },
    actor,
    created,
  };
  assert.equal(
    newTable({ ...base, name: 'mean-weight' }).id,
    newTable({ ...base, name: 'mean-weight', caption: 'Something else.' }).id,
  );
  assert.notEqual(
    newTable({ ...base, name: 'mean-weight' }).id,
    newTable({ ...base, name: 'mean-height' }).id,
  );
  assert.throws(() => newTable({ ...base, name: 'Mean Weight' }), PhdudeError);
  assert.throws(() => newTable({ ...base, name: 'x', caption: '  ' }), PhdudeError);
});

test('newTable: no declared format means all three', () => {
  const table = newTable({
    name: 'mean-weight',
    caption: 'Mean weight by group.',
    source: { dataset: 'DATASET-0123456789', limit: 10 },
    actor,
    created,
  });
  assert.deepEqual(table.formats, ['md', 'latex', 'csv']);
  assert.deepEqual(Object.keys(table.outputs), ['md', 'latex', 'csv']);
  assertValid('table', table);
});

test('newFigure: schema-valid, named by its slug, alt carried through', () => {
  const figure = newFigure({
    name: 'mean-weight',
    caption: 'Mean weight by group.',
    alt: "Bar chart: group b averages 75.5 kg against group a's 71.4 kg.",
    generator: { runtime: 'node', script: 'phdude:bar-chart', args: ['--key', 'mean'] },
    inputs: ['RESULT-0123456789'],
    outputs: [{ path: 'figures/out/mean-weight.svg', format: 'svg' }],
    actor,
    created,
  });

  assertValid('figure', figure);
  assert.match(figure.id, /^FIG-[0-9a-f]{10}$/);
  assert.equal(figure.alt, "Bar chart: group b averages 75.5 kg against group a's 71.4 kg.");
  assert.deepEqual(figure.runs, []);
  assert.equal(figure.state, 'candidate');
});

test('newFigure: a figure without alt text never becomes a record', () => {
  assert.throws(
    () =>
      newFigure({
        name: 'mean-weight',
        caption: 'Mean weight by group.',
        alt: '',
        generator: { runtime: 'node', script: 'phdude:bar-chart', args: [] },
        inputs: [],
        outputs: [{ path: 'figures/out/mean-weight.svg', format: 'svg' }],
        actor,
        created,
      }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.match(err.message, /alt text/);
      return true;
    },
  );
});

const REVIEW = {
  kind: 'reviewer2',
  target: 'CLAIM-0123456789',
  severity: 'major',
  message: 'The claim generalizes past the sampled firms.',
  evidence: ['EVID-0123456789'],
  by: { researcher: 'test', agent: 'claude-code' },
  mode: 'full',
  actor,
  created,
};

test('newReview: schema-valid, opens open, and carries the mode it was written under', () => {
  const review = newReview(REVIEW);
  assert.doesNotThrow(() => assertValid('review', review));
  assert.equal(review.status, 'open');
  assert.equal(review.mode, 'full');
  assert.deepEqual(review.by, { researcher: 'test', agent: 'claude-code' });
  assert.equal(review.suggested_command, undefined, 'no command is invented');
  assert.equal(
    review.id,
    makeId('review', `${REVIEW.kind}\n${REVIEW.target}\n${REVIEW.message}`),
    'the identity is the kind, the target and the message',
  );
});

test('newReview: the same finding twice is one record; a different kind or target is not', () => {
  const first = newReview(REVIEW);
  assert.equal(newReview({ ...REVIEW, message: `  ${REVIEW.message}  ` }).id, first.id);
  assert.notEqual(newReview({ ...REVIEW, kind: 'methodology' }).id, first.id);
  assert.notEqual(newReview({ ...REVIEW, target: 'project' }).id, first.id);
  assert.notEqual(newReview({ ...REVIEW, message: 'Something else entirely.' }).id, first.id);
  assert.equal(
    newReview({ ...REVIEW, severity: 'note', evidence: [] }).id,
    first.id,
    'the severity and the ids behind it are the reviewer revising one finding, not a second',
  );
});

test('newReview: rejects an empty message', () => {
  assert.throws(
    () => newReview({ ...REVIEW, message: '   ' }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.match(err.message, /message must not be empty/);
      return true;
    },
  );
});

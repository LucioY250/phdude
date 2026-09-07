import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analysisPath,
  defaultResultsPath,
  diffResults,
  outputPath,
  planRun,
  resultsFromJson,
  stderrTail,
} from '../../../src/domain/analysis.js';
import { PhdudeError } from '../../../src/domain/errors.js';

const actor = { researcher: 'test', agent: 'node' };
const CREATED = '2026-09-07T10:00:00.000Z';
const ANALYSIS = 'ANALYSIS-0123456789';

function analysis(fields = {}) {
  return {
    id: ANALYSIS,
    name: 'describe survey',
    runtime: 'node',
    script: 'analysis/describe.mjs',
    args: [],
    inputs: ['DATASET-aaaaaaaaaa'],
    outputs: { results: 'analysis/out/describe-survey/results.json', files: [] },
    params: {},
    runs: [],
    ...fields,
  };
}

function dataset(id, hash) {
  return { id, hash, path: `data/${id}.csv` };
}

function incoming(entries) {
  const { results, invalid } = resultsFromJson({ results: entries }, ANALYSIS, actor, CREATED);
  assert.deepEqual(invalid, []);
  return results;
}

test('analysisPath keeps a script inside analysis/ and normalizes the separators', () => {
  assert.equal(analysisPath('analysis/describe.mjs'), 'analysis/describe.mjs');
  assert.equal(analysisPath('  analysis/./steps/describe.mjs '), 'analysis/steps/describe.mjs');
});

test('analysisPath refuses anything that leaves analysis/', () => {
  for (const bad of [
    '',
    '   ',
    'describe.mjs',
    'data/describe.mjs',
    '/etc/passwd',
    'analysis/../../escape.mjs',
    'analysis/..',
    'analysis',
    'analysis/',
  ]) {
    assert.throws(
      () => analysisPath(bad),
      (err) => {
        assert.ok(err instanceof PhdudeError);
        assert.equal(err.code, 'VALIDATION');
        return true;
      },
      `expected ${JSON.stringify(bad)} to be refused`,
    );
  }
});

test('analysisPath names the field it refused, so a results path is not reported as a script', () => {
  assert.throws(
    () => analysisPath('out/results.json', 'results output', 'analysis/out/x/results.json'),
    /analysis results output outside analysis\//,
  );
});

test('outputPath allows any workspace-relative file and refuses an escape', () => {
  assert.equal(outputPath('figures/out/fig-1.svg'), 'figures/out/fig-1.svg');
  assert.equal(outputPath('./tables/out/t1.csv'), 'tables/out/t1.csv');
  for (const bad of ['', '/tmp/x.svg', '../outside.svg', 'analysis/../../x']) {
    assert.throws(() => outputPath(bad), PhdudeError, `expected ${JSON.stringify(bad)} refused`);
  }
});

test('defaultResultsPath slugs the name into a directory under analysis/out/', () => {
  assert.equal(defaultResultsPath('describe survey'), 'analysis/out/describe-survey/results.json');
  assert.equal(defaultResultsPath('Reliability (α)'), 'analysis/out/reliability/results.json');
  assert.equal(defaultResultsPath('###'), 'analysis/out/analysis/results.json');
  assert.doesNotThrow(() => analysisPath(defaultResultsPath('describe survey'), 'results output'));
});

test('planRun collects the hash of every declared input', () => {
  const plan = planRun(analysis({ inputs: ['DATASET-b', 'DATASET-a'] }), [
    dataset('DATASET-a', 'a'.repeat(64)),
    dataset('DATASET-b', 'b'.repeat(64)),
  ]);
  assert.deepEqual(plan.inputHashes, { 'DATASET-b': 'b'.repeat(64), 'DATASET-a': 'a'.repeat(64) });
  assert.equal(plan.upToDate, false, 'an analysis that never ran is never up to date');
});

test('planRun is up to date only when the last successful run saw the same input hashes', () => {
  const inputs = ['DATASET-a'];
  const datasets = [dataset('DATASET-a', 'a'.repeat(64))];
  const successful = {
    at: CREATED,
    exit: 0,
    duration_ms: 1,
    input_hashes: { 'DATASET-a': 'a'.repeat(64) },
    output_hashes: {},
    results: [],
  };

  assert.equal(planRun(analysis({ inputs, runs: [successful] }), datasets).upToDate, true);
  assert.equal(
    planRun(analysis({ inputs, runs: [{ ...successful, exit: 1 }] }), datasets).upToDate,
    false,
    'a failed run never makes an analysis up to date',
  );
  assert.equal(
    planRun(analysis({ inputs, runs: [successful] }), [dataset('DATASET-a', 'c'.repeat(64))])
      .upToDate,
    false,
    'a changed input makes it stale',
  );
});

test('planRun reads the last successful run, not the last run', () => {
  const datasets = [dataset('DATASET-a', 'a'.repeat(64))];
  const run = (exit, hash) => ({
    at: CREATED,
    exit,
    duration_ms: 1,
    input_hashes: { 'DATASET-a': hash },
    output_hashes: {},
    results: [],
  });

  const runs = [run(0, 'c'.repeat(64)), run(0, 'a'.repeat(64)), run(1, 'c'.repeat(64))];
  assert.equal(planRun(analysis({ inputs: ['DATASET-a'], runs }), datasets).upToDate, true);
});

test('planRun is stale when an input was added or removed since the last run', () => {
  const successful = {
    at: CREATED,
    exit: 0,
    duration_ms: 1,
    input_hashes: { 'DATASET-a': 'a'.repeat(64) },
    output_hashes: {},
    results: [],
  };
  const datasets = [dataset('DATASET-a', 'a'.repeat(64)), dataset('DATASET-b', 'b'.repeat(64))];

  assert.equal(
    planRun(analysis({ inputs: ['DATASET-a', 'DATASET-b'], runs: [successful] }), datasets)
      .upToDate,
    false,
  );
  assert.equal(planRun(analysis({ inputs: [], runs: [successful] }), datasets).upToDate, false);
});

test('planRun refuses to call an analysis up to date when an input has no hash', () => {
  const successful = {
    at: CREATED,
    exit: 0,
    duration_ms: 1,
    input_hashes: { 'DATASET-a': null },
    output_hashes: {},
    results: [],
  };
  const plan = planRun(analysis({ inputs: ['DATASET-a'], runs: [successful] }), []);
  assert.deepEqual(plan.inputHashes, { 'DATASET-a': null });
  assert.equal(plan.upToDate, false);
});

test('resultsFromJson turns each entry into a candidate RESULT carrying its key and run time', () => {
  const { results, invalid } = resultsFromJson(
    {
      results: [
        { key: 'mean_age', summary: 'Mean age is 38.4 years', values: { mean: 38.4 }, unit: 'y' },
        { key: 'n', summary: 'The sample holds 312 responses', values: { n: 312 } },
      ],
    },
    ANALYSIS,
    actor,
    CREATED,
  );

  assert.deepEqual(invalid, []);
  assert.equal(results.length, 2);
  const [first, second] = results;
  assert.equal(first.schema, 'phdude.result');
  assert.equal(first.from, ANALYSIS);
  assert.equal(first.state, 'candidate');
  assert.deepEqual(first.values, { mean: 38.4 });
  assert.deepEqual(first.ext, { analysis: { key: 'mean_age', run_at: CREATED, unit: 'y' } });
  assert.deepEqual(second.ext, { analysis: { key: 'n', run_at: CREATED } });
  assert.match(first.id, /^RESULT-[0-9a-f]{10}$/);
  assert.notEqual(first.id, second.id);
});

test('resultsFromJson derives the id from the summary and the analysis, not from the key', () => {
  const [a] = incoming([{ key: 'mean_age', summary: 'Mean age is 38.4 years', values: { m: 1 } }]);
  const [b] = incoming([{ key: 'renamed', summary: 'Mean age is 38.4 years', values: { m: 2 } }]);
  assert.equal(a.id, b.id, 'the summary and the analysis are the identity');

  const other = resultsFromJson(
    { results: [{ key: 'mean_age', summary: 'Mean age is 38.4 years', values: { m: 1 } }] },
    'ANALYSIS-9999999999',
    actor,
    CREATED,
  );
  assert.notEqual(other.results[0].id, a.id, 'a different analysis is a different result');
});

test('resultsFromJson reports every unusable entry instead of throwing', () => {
  const { results, invalid } = resultsFromJson(
    {
      results: [
        { key: 'ok', summary: 'A usable result', values: {} },
        { key: '   ', summary: 'No key', values: {} },
        { key: 'blank', summary: '  ', values: {} },
        { key: 'ok', summary: 'A repeated key', values: {} },
        'not an object',
      ],
    },
    ANALYSIS,
    actor,
    CREATED,
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].ext.analysis.key, 'ok');
  assert.equal(invalid.length, 4);
  assert.match(invalid[0], /results\[1\]/);
  assert.match(invalid[1], /results\[2\]/);
  assert.match(invalid[2], /repeats/);
  assert.match(invalid[3], /results\[4\]/);
});

test('resultsFromJson accepts a file with no results at all', () => {
  assert.deepEqual(resultsFromJson({ results: [] }, ANALYSIS, actor, CREATED), {
    results: [],
    invalid: [],
  });
  assert.deepEqual(resultsFromJson({}, ANALYSIS, actor, CREATED), { results: [], invalid: [] });
});

test('diffResults creates every result of a first run', () => {
  const results = incoming([
    { key: 'a', summary: 'Result A', values: { v: 1 } },
    { key: 'b', summary: 'Result B', values: { v: 2 } },
  ]);
  const diff = diffResults([], results);
  assert.deepEqual(diff.create, results);
  assert.deepEqual(diff.reject, []);
  assert.deepEqual(diff.keep, []);
});

test('diffResults keeps a result whose key, summary and values all came back unchanged', () => {
  const [first] = incoming([{ key: 'a', summary: 'Result A', values: { v: 1 } }]);
  const again = incoming([{ key: 'a', summary: 'Result A', values: { v: 1 } }]);

  const diff = diffResults([first], again);
  assert.deepEqual(diff.create, []);
  assert.deepEqual(diff.reject, []);
  assert.deepEqual(diff.keep, [first]);
});

test('diffResults ignores key order inside values when deciding a result is unchanged', () => {
  const [first] = incoming([{ key: 'a', summary: 'Result A', values: { x: 1, y: 2 } }]);
  const again = incoming([{ key: 'a', summary: 'Result A', values: { y: 2, x: 1 } }]);
  assert.deepEqual(diffResults([first], again).keep, [first]);
});

test('diffResults treats a changed unit as a changed result', () => {
  const [first] = incoming([{ key: 'a', summary: 'Result A', values: { v: 1 }, unit: 'kg' }]);
  const again = incoming([{ key: 'a', summary: 'Result A', values: { v: 1 }, unit: 'g' }]);
  assert.deepEqual(diffResults([first], again).keep, []);
  assert.deepEqual(diffResults([first], again).create, again);
});

test('diffResults supersedes the old result when the same key comes back with a new summary', () => {
  const [first] = incoming([{ key: 'a', summary: 'Mean age is 38.4 years', values: { m: 38.4 } }]);
  const again = incoming([{ key: 'a', summary: 'Mean age is 39.1 years', values: { m: 39.1 } }]);

  const diff = diffResults([first], again);
  assert.deepEqual(diff.create, again);
  assert.deepEqual(diff.keep, []);
  assert.equal(diff.reject.length, 1);
  assert.equal(diff.reject[0].id, first.id);
  assert.equal(diff.reject[0].state, 'rejected');
  assert.equal(diff.reject[0].superseded_by, again[0].id);
  assert.equal(first.state, 'candidate', 'the existing object is not mutated in place');
});

test('diffResults rewrites in place when only the values changed under an unchanged summary', () => {
  const [first] = incoming([{ key: 'a', summary: 'Mean age', values: { m: 38.4 } }]);
  const again = incoming([{ key: 'a', summary: 'Mean age', values: { m: 39.1 } }]);
  assert.equal(first.id, again[0].id, 'the summary is the identity, so the id did not change');

  const diff = diffResults([first], again);
  assert.deepEqual(diff.create, again);
  assert.deepEqual(diff.keep, []);
  assert.deepEqual(diff.reject, [], 'a record cannot supersede itself');
});

test('diffResults leaves a result whose key the run no longer reports alone', () => {
  const [gone] = incoming([{ key: 'gone', summary: 'Result gone', values: {} }]);
  const again = incoming([{ key: 'a', summary: 'Result A', values: {} }]);

  const diff = diffResults([gone], again);
  assert.deepEqual(diff.create, again);
  assert.deepEqual(diff.reject, []);
  assert.deepEqual(diff.keep, []);
});

test('diffResults ignores an existing result that carries no analysis key', () => {
  const handWritten = { id: 'RESULT-1111111111', summary: 'By hand', from: ANALYSIS, values: {} };
  const again = incoming([{ key: 'a', summary: 'Result A', values: {} }]);
  const diff = diffResults([handWritten], again);
  assert.deepEqual(diff.create, again);
  assert.deepEqual(diff.reject, []);
});

test('stderrTail keeps the last 2000 characters and nothing more', () => {
  assert.equal(stderrTail(''), '');
  assert.equal(stderrTail(undefined), '');
  assert.equal(stderrTail('no such column: age'), 'no such column: age');
  const long = 'x'.repeat(2500) + 'END';
  assert.equal(stderrTail(long).length, 2000);
  assert.ok(stderrTail(long).endsWith('END'));
});

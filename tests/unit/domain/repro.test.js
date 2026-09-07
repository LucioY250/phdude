import test from 'node:test';
import assert from 'node:assert/strict';
import { staleness } from '../../../src/domain/repro.js';
import { sha256 } from '../../../src/domain/hash.js';
import { stableStringify } from '../../../src/domain/normalize.js';

const OLD = 'a'.repeat(64);
const NEW = 'b'.repeat(64);

const DATASET = { id: 'DATASET-0123456789', schema: 'phdude.dataset', path: 'data/survey.csv' };

function dataset(overrides = {}) {
  return { ...DATASET, hash: OLD, ...overrides };
}

function result(overrides = {}) {
  return {
    id: 'RESULT-1111111111',
    schema: 'phdude.result',
    from: 'ANALYSIS-2222222222',
    values: { share: 0.75 },
    state: 'candidate',
    ...overrides,
  };
}

const resultHash = (values) => sha256(stableStringify(values));

function analysis(overrides = {}) {
  return {
    id: 'ANALYSIS-2222222222',
    schema: 'phdude.analysis',
    name: 'describe',
    inputs: [DATASET.id],
    outputs: { results: 'analysis/out/describe/results.json', files: [] },
    runs: [],
    ...overrides,
  };
}

function analysisRun(overrides = {}) {
  return {
    at: '2026-09-01T00:00:00Z',
    exit: 0,
    duration_ms: 0,
    input_hashes: { [DATASET.id]: OLD },
    output_hashes: { 'analysis/out/describe/results.json': NEW },
    results: [],
    ...overrides,
  };
}

function table(overrides = {}) {
  return {
    id: 'TABLE-3333333333',
    schema: 'phdude.table',
    name: 'daily-use',
    source: { result: 'RESULT-1111111111' },
    outputs: { md: 'tables/out/daily-use.md' },
    runs: [],
    ...overrides,
  };
}

function figure(overrides = {}) {
  return {
    id: 'FIG-4444444444',
    schema: 'phdude.figure',
    name: 'respondents',
    alt: 'A bar chart of respondents per channel.',
    inputs: [DATASET.id],
    outputs: [{ path: 'figures/out/respondents.svg', format: 'svg' }],
    runs: [],
    ...overrides,
  };
}

test('staleness reports nothing for a workspace with no analyses, tables or figures', () => {
  assert.deepEqual(staleness({}), []);
});

test('staleness orders analyses, then tables, then figures', () => {
  const items = staleness({
    figures: [figure()],
    tables: [table()],
    analyses: [analysis()],
  });
  assert.deepEqual(
    items.map((i) => i.kind),
    ['analysis', 'table', 'figure'],
  );
  assert.deepEqual(
    items.map((i) => i.id),
    ['ANALYSIS-2222222222', 'TABLE-3333333333', 'FIG-4444444444'],
  );
});

test('staleness calls an analysis that has never run never-run', () => {
  const [item] = staleness({ analyses: [analysis()], datasets: [dataset()] });
  assert.equal(item.status, 'never-run');
  assert.deepEqual(item.reasons, [{ kind: 'never-run' }]);
  assert.equal(item.name, 'describe');
});

test('staleness ignores a failed run: an analysis whose only run failed has never run', () => {
  const [item] = staleness({
    analyses: [analysis({ runs: [analysisRun({ exit: 1, output_hashes: {} })] })],
    datasets: [dataset()],
    fileHashes: { 'data/survey.csv': OLD },
    present: { 'analysis/out/describe/results.json': true },
  });
  assert.equal(item.status, 'never-run');
});

test('staleness calls an analysis up to date when its inputs still hash the same', () => {
  const [item] = staleness({
    analyses: [analysis({ runs: [analysisRun()] })],
    datasets: [dataset()],
    fileHashes: { 'data/survey.csv': OLD },
    present: { 'analysis/out/describe/results.json': true },
  });
  assert.equal(item.status, 'up-to-date');
  assert.deepEqual(item.reasons, []);
});

// The file drifted from the record that describes it, which is a different problem from an
// input that merely moved since the run: re-running would read bytes the workspace never
// registered, so the drift is what gets reported.
test('staleness reports an analysis whose dataset file changed on disk', () => {
  const [item] = staleness({
    analyses: [analysis({ runs: [analysisRun()] })],
    datasets: [dataset()],
    fileHashes: { 'data/survey.csv': NEW },
    present: { 'analysis/out/describe/results.json': true },
  });
  assert.equal(item.status, 'stale');
  assert.deepEqual(item.reasons, [
    { kind: 'unregistered-input', input: DATASET.id, registered: OLD, current: NEW },
  ]);
});

test('staleness reports an analysis pointed at an input its last run never read', () => {
  const other = { id: 'DATASET-9999999999', path: 'data/extra.csv', hash: NEW };
  const [item] = staleness({
    analyses: [analysis({ inputs: [DATASET.id, other.id], runs: [analysisRun()] })],
    datasets: [dataset(), other],
    fileHashes: { 'data/survey.csv': OLD, 'data/extra.csv': NEW },
    present: { 'analysis/out/describe/results.json': true },
  });
  assert.equal(item.status, 'stale');
  assert.deepEqual(item.reasons, [
    { kind: 'stale-input', input: other.id, recorded: null, current: NEW },
  ]);
});

test('staleness reports an analysis input the workspace no longer holds', () => {
  const [item] = staleness({
    analyses: [analysis({ runs: [analysisRun()] })],
    datasets: [],
    present: { 'analysis/out/describe/results.json': true },
  });
  assert.equal(item.status, 'stale');
  assert.deepEqual(item.reasons, [{ kind: 'missing-input', input: DATASET.id }]);
});

test('staleness reports a declared output that is not on disk, over any staleness', () => {
  const [item] = staleness({
    analyses: [
      analysis({
        outputs: { results: 'analysis/out/describe/results.json', files: ['data/derived.csv'] },
        runs: [analysisRun()],
      }),
    ],
    datasets: [dataset()],
    fileHashes: { 'data/survey.csv': NEW },
    present: { 'analysis/out/describe/results.json': true, 'data/derived.csv': false },
  });
  assert.equal(item.status, 'missing-output');
  assert.deepEqual(item.reasons, [
    { kind: 'missing-output', path: 'data/derived.csv' },
    { kind: 'unregistered-input', input: DATASET.id, registered: OLD, current: NEW },
  ]);
});

test('staleness reads a table build against the current hash of its result', () => {
  const values = { share: 0.75 };
  const hash = resultHash(values);
  const built = table({ runs: [{ at: '2026-09-01T00:00:00Z', source_hash: hash }] });
  const upToDate = staleness({
    tables: [built],
    results: [result({ values })],
    present: { 'tables/out/daily-use.md': true },
  });
  assert.equal(upToDate[0].status, 'up-to-date');

  const moved = staleness({
    tables: [built],
    results: [result({ values: { share: 0.8 } })],
    present: { 'tables/out/daily-use.md': true },
  });
  assert.equal(moved[0].status, 'stale');
  assert.deepEqual(moved[0].reasons, [
    {
      kind: 'stale-input',
      input: 'RESULT-1111111111',
      recorded: hash,
      current: resultHash({ share: 0.8 }),
    },
  ]);
});

test('staleness reports a table output that is missing', () => {
  const hash = resultHash({ share: 0.75 });
  const [item] = staleness({
    tables: [table({ runs: [{ at: '2026-09-01T00:00:00Z', source_hash: hash }] })],
    results: [result()],
    present: { 'tables/out/daily-use.md': false },
  });
  assert.equal(item.status, 'missing-output');
  assert.deepEqual(item.reasons, [{ kind: 'missing-output', path: 'tables/out/daily-use.md' }]);
});

test('staleness calls a table that has never been built never-run', () => {
  const [item] = staleness({ tables: [table()], results: [result()] });
  assert.equal(item.status, 'never-run');
  assert.deepEqual(item.reasons, [{ kind: 'never-run' }]);
});

test('staleness reads a figure through the figure rules, alt text included', () => {
  const [item] = staleness({
    figures: [figure({ alt: '  ' })],
    datasets: [dataset()],
    fileHashes: { 'data/survey.csv': OLD },
  });
  assert.equal(item.status, 'never-run');
  assert.deepEqual(item.reasons, [{ kind: 'missing-alt' }, { kind: 'never-run' }]);
});

test('staleness reports a figure whose result moved since the last successful build', () => {
  const built = resultHash({ share: 0.75 });
  const [item] = staleness({
    figures: [
      figure({
        inputs: ['RESULT-1111111111'],
        runs: [
          {
            at: '2026-09-01T00:00:00Z',
            exit: 0,
            input_hashes: { 'RESULT-1111111111': built },
            output_hashes: { 'figures/out/respondents.svg': NEW },
          },
        ],
      }),
    ],
    results: [result({ values: { share: 0.9 } })],
    present: { 'figures/out/respondents.svg': true },
  });
  assert.equal(item.status, 'stale');
  assert.deepEqual(item.reasons, [
    {
      kind: 'stale-input',
      input: 'RESULT-1111111111',
      recorded: built,
      current: resultHash({ share: 0.9 }),
    },
  ]);
});

// The case the figure rules cannot see on their own: a rebuild after an edit records the new
// bytes, so nothing is stale against the last run - but the DATASET the figure claims to be
// built from describes bytes that are no longer in the file.
test('staleness reports a figure rebuilt from bytes the registered dataset no longer describes', () => {
  const [item] = staleness({
    figures: [
      figure({
        runs: [
          {
            at: '2026-09-01T00:00:00Z',
            exit: 0,
            input_hashes: { [DATASET.id]: NEW },
            output_hashes: { 'figures/out/respondents.svg': NEW },
          },
        ],
      }),
    ],
    datasets: [dataset({ hash: OLD })],
    fileHashes: { 'data/survey.csv': NEW },
    present: { 'figures/out/respondents.svg': true },
  });
  assert.equal(item.status, 'stale');
  assert.deepEqual(item.reasons, [
    { kind: 'unregistered-input', input: DATASET.id, registered: OLD, current: NEW },
  ]);
});

test('staleness reports one drifted file once, as drift rather than as two reasons', () => {
  const [item] = staleness({
    tables: [
      table({
        source: { dataset: DATASET.id },
        runs: [{ at: '2026-09-01T00:00:00Z', source_hash: OLD }],
      }),
    ],
    datasets: [dataset({ hash: OLD })],
    fileHashes: { 'data/survey.csv': NEW },
    present: { 'tables/out/daily-use.md': true },
  });
  assert.equal(item.status, 'stale');
  assert.deepEqual(item.reasons, [
    { kind: 'unregistered-input', input: DATASET.id, registered: OLD, current: NEW },
  ]);
});

test('staleness is pure: it never touches the records it was given', () => {
  const records = {
    analyses: [analysis({ runs: [analysisRun()] })],
    tables: [table()],
    figures: [figure()],
    datasets: [dataset()],
    results: [result()],
    fileHashes: { 'data/survey.csv': NEW },
    present: {},
  };
  const before = stableStringify(records);
  staleness(records);
  assert.equal(stableStringify(records), before);
});

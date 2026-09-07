import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHIPPED_GENERATORS,
  figureName,
  generatorScript,
  staleness,
  validateFigure,
} from '../../../src/domain/figures.js';

const FIELDS = {
  name: 'mean-weight',
  caption: 'Mean weight by group.',
  alt: 'A bar chart: group b is 4 kg heavier than group a.',
  generator: {
    runtime: 'node',
    script: 'phdude:bar-chart',
    args: ['--input', 'analysis/out/weights/results.json'],
  },
  inputs: ['RESULT-0123456789'],
  outputs: [{ path: 'figures/out/mean-weight.svg', format: 'svg' }],
};

function figure(overrides = {}) {
  return { id: 'FIG-0123456789', ...FIELDS, runs: [], ...overrides };
}

test('figureName accepts a slug and refuses anything that could leave figures/out', () => {
  assert.equal(figureName('mean-weight'), 'mean-weight');
  for (const bad of ['', 'Mean Weight', '../escape', 'a/b', 'a_b']) {
    assert.throws(() => figureName(bad), { code: 'VALIDATION' }, `accepted ${JSON.stringify(bad)}`);
  }
});

test('generatorScript resolves the shipped generator by its phdude: name', () => {
  assert.deepEqual(generatorScript('phdude:bar-chart'), { shipped: 'bar-chart.mjs', path: null });
  assert.deepEqual(Object.keys(SHIPPED_GENERATORS), ['phdude:bar-chart']);
});

test('generatorScript accepts a workspace script under figures/', () => {
  assert.deepEqual(generatorScript('figures/scatter.mjs'), {
    shipped: null,
    path: 'figures/scatter.mjs',
  });
  assert.deepEqual(generatorScript('figures/gen/plot.py'), {
    shipped: null,
    path: 'figures/gen/plot.py',
  });
});

test('generatorScript refuses a script outside figures/ and an unknown phdude: name', () => {
  for (const bad of [
    '',
    'phdude:scatter',
    'analysis/plot.mjs',
    '/usr/bin/plot',
    'figures/../analysis/plot.mjs',
    'figures',
    'figures/',
  ]) {
    assert.throws(
      () => generatorScript(bad),
      { code: 'VALIDATION' },
      `accepted ${JSON.stringify(bad)}`,
    );
  }
});

test('validateFigure returns the normalized fields of a well-formed figure', () => {
  assert.deepEqual(validateFigure(FIELDS), {
    name: 'mean-weight',
    caption: 'Mean weight by group.',
    alt: 'A bar chart: group b is 4 kg heavier than group a.',
    generator: {
      runtime: 'node',
      script: 'phdude:bar-chart',
      args: ['--input', 'analysis/out/weights/results.json'],
    },
    inputs: ['RESULT-0123456789'],
    outputs: [{ path: 'figures/out/mean-weight.svg', format: 'svg' }],
  });
});

test('validateFigure refuses a figure without alt text (PRD §100)', () => {
  for (const alt of [undefined, null, '', '   ']) {
    assert.throws(
      () => validateFigure({ ...FIELDS, alt }),
      (err) => {
        assert.equal(err.code, 'VALIDATION');
        assert.match(err.message, /alt/);
        return true;
      },
      `accepted alt ${JSON.stringify(alt)}`,
    );
  }
});

test('validateFigure refuses a caption-less figure, a bad runtime and no outputs', () => {
  assert.throws(() => validateFigure({ ...FIELDS, caption: '  ' }), { code: 'VALIDATION' });
  assert.throws(() => validateFigure({ ...FIELDS, generator: { script: 'phdude:bar-chart' } }), {
    code: 'VALIDATION',
  });
  assert.throws(() => validateFigure({ ...FIELDS, outputs: [] }), { code: 'VALIDATION' });
});

test('validateFigure refuses an output outside figures/, an unknown format and a duplicate path', () => {
  assert.throws(
    () => validateFigure({ ...FIELDS, outputs: [{ path: 'outputs/x.svg', format: 'svg' }] }),
    { code: 'VALIDATION' },
  );
  assert.throws(
    () => validateFigure({ ...FIELDS, outputs: [{ path: 'figures/out/x.svg', format: 'webp' }] }),
    { code: 'VALIDATION' },
  );
  assert.throws(
    () =>
      validateFigure({
        ...FIELDS,
        outputs: [
          { path: 'figures/out/x.svg', format: 'svg' },
          { path: 'figures/out/x.svg', format: 'svg' },
        ],
      }),
    { code: 'VALIDATION' },
  );
});

test('validateFigure refuses an input that is not a result or a dataset', () => {
  assert.throws(() => validateFigure({ ...FIELDS, inputs: ['CLAIM-0123456789'] }), {
    code: 'VALIDATION',
  });
  assert.deepEqual(validateFigure({ ...FIELDS, inputs: [] }).inputs, []);
});

test('staleness calls a figure that has never run never-run, without a missing-output finding', () => {
  const report = staleness(figure(), { inputHashes: { 'RESULT-0123456789': 'a'.repeat(64) } });
  assert.equal(report.id, 'FIG-0123456789');
  assert.equal(report.status, 'never-run');
  assert.deepEqual(
    report.findings.map((f) => f.kind),
    ['never-run'],
  );
});

test('staleness calls a figure whose inputs still hash the same up-to-date', () => {
  const hash = 'a'.repeat(64);
  const report = staleness(
    figure({
      runs: [
        {
          at: '2026-09-07T10:00:00Z',
          exit: 0,
          duration_ms: 5,
          input_hashes: { 'RESULT-0123456789': hash },
          output_hashes: { 'figures/out/mean-weight.svg': 'b'.repeat(64) },
        },
      ],
    }),
    {
      inputHashes: { 'RESULT-0123456789': hash },
      present: { 'figures/out/mean-weight.svg': true },
    },
  );
  assert.equal(report.status, 'up-to-date');
  assert.deepEqual(report.findings, []);
});

test('staleness reports an input whose hash moved since the last run', () => {
  const report = staleness(
    figure({
      runs: [
        {
          at: '2026-09-07T10:00:00Z',
          exit: 0,
          duration_ms: 5,
          input_hashes: { 'RESULT-0123456789': 'a'.repeat(64) },
          output_hashes: { 'figures/out/mean-weight.svg': 'b'.repeat(64) },
        },
      ],
    }),
    {
      inputHashes: { 'RESULT-0123456789': 'c'.repeat(64) },
      present: { 'figures/out/mean-weight.svg': true },
    },
  );
  assert.equal(report.status, 'stale');
  assert.deepEqual(report.findings, [
    {
      kind: 'stale-input',
      input: 'RESULT-0123456789',
      recorded: 'a'.repeat(64),
      current: 'c'.repeat(64),
    },
  ]);
});

test('staleness reports an input the workspace no longer has', () => {
  const report = staleness(
    figure({
      runs: [
        {
          at: '2026-09-07T10:00:00Z',
          exit: 0,
          duration_ms: 5,
          input_hashes: { 'RESULT-0123456789': 'a'.repeat(64) },
          output_hashes: { 'figures/out/mean-weight.svg': 'b'.repeat(64) },
        },
      ],
    }),
    {
      inputHashes: { 'RESULT-0123456789': null },
      present: { 'figures/out/mean-weight.svg': true },
    },
  );
  assert.equal(report.status, 'stale');
  assert.deepEqual(
    report.findings.map((f) => f.kind),
    ['missing-input'],
  );
});

test('staleness reports a declared output that is not on disk', () => {
  const hash = 'a'.repeat(64);
  const report = staleness(
    figure({
      runs: [
        {
          at: '2026-09-07T10:00:00Z',
          exit: 0,
          duration_ms: 5,
          input_hashes: { 'RESULT-0123456789': hash },
          output_hashes: { 'figures/out/mean-weight.svg': 'b'.repeat(64) },
        },
      ],
    }),
    { inputHashes: { 'RESULT-0123456789': hash }, present: {} },
  );
  assert.equal(report.status, 'missing-output');
  assert.deepEqual(report.findings, [
    { kind: 'missing-output', path: 'figures/out/mean-weight.svg' },
  ]);
});

test('staleness reports missing alt text without calling the figure stale', () => {
  const hash = 'a'.repeat(64);
  const report = staleness(
    figure({
      alt: '  ',
      runs: [
        {
          at: '2026-09-07T10:00:00Z',
          exit: 0,
          duration_ms: 5,
          input_hashes: { 'RESULT-0123456789': hash },
          output_hashes: { 'figures/out/mean-weight.svg': 'b'.repeat(64) },
        },
      ],
    }),
    {
      inputHashes: { 'RESULT-0123456789': hash },
      present: { 'figures/out/mean-weight.svg': true },
    },
  );
  assert.equal(report.status, 'up-to-date');
  assert.deepEqual(report.findings, [{ kind: 'missing-alt' }]);
});

test('staleness ignores a failed run: a figure whose only run exited non-zero has never run', () => {
  const report = staleness(
    figure({
      runs: [
        {
          at: '2026-09-07T10:00:00Z',
          exit: 3,
          duration_ms: 5,
          input_hashes: { 'RESULT-0123456789': 'a'.repeat(64) },
          output_hashes: {},
        },
      ],
    }),
    { inputHashes: { 'RESULT-0123456789': 'a'.repeat(64) } },
  );
  assert.equal(report.status, 'never-run');
});

test('staleness reads the last successful run, not the first', () => {
  const runs = ['a', 'b'].map((h, i) => ({
    at: `2026-09-0${7 + i}T10:00:00Z`,
    exit: 0,
    duration_ms: 5,
    input_hashes: { 'RESULT-0123456789': h.repeat(64) },
    output_hashes: { 'figures/out/mean-weight.svg': 'c'.repeat(64) },
  }));
  const report = staleness(figure({ runs }), {
    inputHashes: { 'RESULT-0123456789': 'b'.repeat(64) },
    present: { 'figures/out/mean-weight.svg': true },
  });
  assert.equal(report.status, 'up-to-date');
});

test('staleness is pure: it never touches the figure it was given', () => {
  const fig = figure();
  const before = JSON.stringify(fig);
  staleness(fig, { inputHashes: {} });
  assert.equal(JSON.stringify(fig), before);
});

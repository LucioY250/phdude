import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TABLE_FORMATS,
  escapeLatex,
  formatValue,
  renderCsv,
  renderLatex,
  renderMarkdown,
  renderTable,
  rowsFrom,
  tableFormats,
  tableName,
  tableOutputs,
} from '../../../src/domain/tables.js';

const RESULT = {
  id: 'RESULT-0123456789',
  summary: 'Group b outweighs group a.',
  values: { a: 71.4, b: 75.5, c: 68.2 },
};

const SPEC = {
  name: 'mean-weight',
  caption: 'Mean weight by group.',
  columns: [
    { key: 'key', label: 'Group' },
    { key: 'value', label: 'Mean', format: 'number:2' },
  ],
};

const ROWS = [
  { key: 'a', value: 71.4 },
  { key: 'b', value: 75.5 },
];

test('tableName accepts a slug and refuses anything that could leave tables/out', () => {
  assert.equal(tableName('mean-weight'), 'mean-weight');
  assert.equal(tableName('  table1  '), 'table1');

  for (const bad of ['', '   ', 'Mean Weight', '../escape', 'a/b', 'a_b', '-lead', 'trail-']) {
    assert.throws(() => tableName(bad), { code: 'VALIDATION' }, `accepted ${JSON.stringify(bad)}`);
  }
});

test('tableFormats defaults to every format and refuses an unknown one', () => {
  assert.deepEqual(tableFormats(undefined), TABLE_FORMATS);
  assert.deepEqual(tableFormats([]), TABLE_FORMATS);
  assert.deepEqual(tableFormats(['csv', 'md']), ['md', 'csv']);
  assert.deepEqual(tableFormats(['md', 'md']), ['md']);
  assert.throws(() => tableFormats(['xlsx']), { code: 'VALIDATION' });
});

test('tableOutputs names one file per format under tables/out', () => {
  assert.deepEqual(tableOutputs('mean-weight', TABLE_FORMATS), {
    md: 'tables/out/mean-weight.md',
    latex: 'tables/out/mean-weight.tex',
    csv: 'tables/out/mean-weight.csv',
  });
  assert.deepEqual(tableOutputs('mean-weight', ['csv']), { csv: 'tables/out/mean-weight.csv' });
});

test('formatValue renders numbers, percentages and text deterministically', () => {
  assert.equal(formatValue(71.4, 'number:2'), '71.40');
  assert.equal(formatValue('71.4', 'number:0'), '71');
  assert.equal(formatValue(0.4237, 'percent:1'), '42.4%');
  assert.equal(formatValue(1, 'percent:0'), '100%');
  assert.equal(formatValue(71.4, 'text'), '71.4');
  assert.equal(formatValue(71.4, undefined), '71.4');
  assert.equal(formatValue(true, undefined), 'true');
  assert.equal(formatValue(undefined, 'number:2'), '');
  assert.equal(formatValue(null, 'text'), '');
});

test('formatValue leaves a value it cannot read as a number alone', () => {
  assert.equal(formatValue('n/a', 'number:2'), 'n/a');
  assert.equal(formatValue('n/a', 'percent:1'), 'n/a');
  assert.equal(formatValue('', 'number:2'), '');
});

test('formatValue writes a nested value as stable JSON rather than [object Object]', () => {
  assert.equal(formatValue({ b: 2, a: 1 }, 'text'), '{"a":1,"b":2}');
  assert.equal(formatValue([1, 2], 'text'), '[1,2]');
});

test('escapeLatex escapes every special character exactly once', () => {
  assert.equal(escapeLatex('50% & rising'), '50\\% \\& rising');
  assert.equal(escapeLatex('a_b #1 $x$'), 'a\\_b \\#1 \\$x\\$');
  assert.equal(escapeLatex('{a}'), '\\{a\\}');
  assert.equal(escapeLatex('~ ^'), '\\textasciitilde{} \\textasciicircum{}');
  // The braces the backslash replacement introduces must not be escaped a second time.
  assert.equal(escapeLatex('a\\b'), 'a\\textbackslash{}b');
});

test('rowsFrom turns a flat result into one row per key, in the order the analysis wrote them', () => {
  const { columns, rows } = rowsFrom({ result: RESULT.id }, { result: RESULT });
  assert.deepEqual(columns, [
    { key: 'key', label: 'Key' },
    { key: 'value', label: 'Value' },
  ]);
  assert.deepEqual(rows, [
    { key: 'a', value: 71.4 },
    { key: 'b', value: 75.5 },
    { key: 'c', value: 68.2 },
  ]);
});

test('rowsFrom takes an array of row objects as the rows themselves', () => {
  const result = {
    id: 'RESULT-0123456789',
    values: [
      { group: 'a', mean: 71.4 },
      { group: 'b', mean: 75.5, sd: 2.1 },
    ],
  };
  const { columns, rows } = rowsFrom({ result: result.id }, { result });
  assert.deepEqual(columns, [
    { key: 'group', label: 'group' },
    { key: 'mean', label: 'mean' },
    { key: 'sd', label: 'sd' },
  ]);
  assert.deepEqual(rows, result.values);
});

test('rowsFrom wraps an array of bare values in a single value column', () => {
  const result = { id: 'RESULT-0123456789', values: [1, 2] };
  const { columns, rows } = rowsFrom({ result: result.id }, { result });
  assert.deepEqual(columns, [{ key: 'value', label: 'Value' }]);
  assert.deepEqual(rows, [{ value: 1 }, { value: 2 }]);
});

test('rowsFrom reads a dataset from its parsed table, header first', () => {
  const table = [
    ['id', 'age', 'group'],
    ['1', '31', 'a'],
    ['2', '44', 'b'],
  ];
  const { columns, rows } = rowsFrom(
    { dataset: 'DATASET-0123456789' },
    { dataset: { id: 'DATASET-0123456789', path: 'data/survey.csv' }, table },
  );
  assert.deepEqual(columns, [
    { key: 'id', label: 'id' },
    { key: 'age', label: 'age' },
    { key: 'group', label: 'group' },
  ]);
  assert.deepEqual(rows, [
    { id: '1', age: '31', group: 'a' },
    { id: '2', age: '44', group: 'b' },
  ]);
});

test('rowsFrom applies the source columns in the order they were named, and the limit', () => {
  const table = [
    ['id', 'age', 'group'],
    ['1', '31', 'a'],
    ['2', '44', 'b'],
    ['3', '52', 'a'],
  ];
  const dataset = { id: 'DATASET-0123456789', path: 'data/survey.csv' };
  const { columns, rows } = rowsFrom(
    { dataset: dataset.id, columns: ['group', 'age'], limit: 2 },
    { dataset, table },
  );
  assert.deepEqual(columns, [
    { key: 'group', label: 'group' },
    { key: 'age', label: 'age' },
  ]);
  assert.deepEqual(rows, [
    { group: 'a', age: '31' },
    { group: 'b', age: '44' },
  ]);
});

test('rowsFrom names an unnamed header cell the way the dataset profile does', () => {
  const table = [
    ['id', ''],
    ['1', 'x'],
  ];
  const { columns } = rowsFrom(
    { dataset: 'DATASET-0123456789' },
    { dataset: { id: 'DATASET-0123456789', path: 'data/survey.csv' }, table },
  );
  assert.deepEqual(
    columns.map((c) => c.key),
    ['id', 'column_2'],
  );
});

test('rowsFrom refuses a source that names neither, both, or a column the dataset has not got', () => {
  assert.throws(() => rowsFrom({}, {}), { code: 'VALIDATION' });
  assert.throws(() => rowsFrom({ result: 'RESULT-1', dataset: 'DATASET-1' }, {}), {
    code: 'VALIDATION',
  });

  const dataset = { id: 'DATASET-0123456789', path: 'data/survey.csv' };
  assert.throws(
    () =>
      rowsFrom({ dataset: dataset.id, columns: ['weight'] }, { dataset, table: [['id'], ['1']] }),
    { code: 'VALIDATION' },
  );
});

test('rowsFrom refuses a dataset whose file held no table', () => {
  const dataset = { id: 'DATASET-0123456789', path: 'data/notes.txt' };
  assert.throws(() => rowsFrom({ dataset: dataset.id }, { dataset, table: null }), {
    code: 'VALIDATION',
  });
  assert.throws(() => rowsFrom({ dataset: dataset.id }, { dataset, table: [] }), {
    code: 'VALIDATION',
  });
});

test('renderMarkdown writes a pipe table, a caption line and right-aligned numbers', () => {
  assert.equal(
    renderMarkdown(SPEC, ROWS),
    [
      '| Group | Mean |',
      '| --- | ---: |',
      '| a | 71.40 |',
      '| b | 75.50 |',
      '',
      'Table: Mean weight by group.',
      '',
    ].join('\n'),
  );
});

test('renderMarkdown escapes a pipe and flattens a newline inside a cell', () => {
  const text = renderMarkdown({ name: 'x', caption: '', columns: [{ key: 'k', label: 'K' }] }, [
    { k: 'a|b\nc' },
  ]);
  assert.equal(text, ['| K |', '| --- |', '| a\\|b c |', ''].join('\n'));
});

test('renderLatex writes a booktabs table with a caption, a label and column alignment', () => {
  assert.equal(
    renderLatex(SPEC, ROWS),
    [
      '\\begin{table}[htbp]',
      '\\centering',
      '\\caption{Mean weight by group.}',
      '\\label{tab:mean-weight}',
      '\\begin{tabular}{lr}',
      '\\toprule',
      'Group & Mean \\\\',
      '\\midrule',
      'a & 71.40 \\\\',
      'b & 75.50 \\\\',
      '\\bottomrule',
      '\\end{tabular}',
      '\\end{table}',
      '',
    ].join('\n'),
  );
});

test('renderLatex escapes the caption, the headers and the cells', () => {
  const text = renderLatex(
    { name: 'x', caption: '100% of a_b', columns: [{ key: 'k', label: 'A & B' }] },
    [{ k: '#1' }],
  );
  assert.match(text, /\\caption\{100\\% of a\\_b\}/);
  assert.match(text, /A \\& B \\\\/);
  assert.match(text, /\\#1 \\\\/);
});

test('renderCsv quotes only the fields that need it', () => {
  assert.equal(renderCsv(SPEC, ROWS), ['Group,Mean', 'a,71.40', 'b,75.50', ''].join('\n'));
  assert.equal(
    renderCsv({ name: 'x', caption: 'c', columns: [{ key: 'k', label: 'K' }] }, [
      { k: 'a,b' },
      { k: 'say "hi"' },
    ]),
    ['K', '"a,b"', '"say ""hi"""', ''].join('\n'),
  );
});

test('every renderer writes a header even when there are no rows', () => {
  assert.equal(
    renderMarkdown(SPEC, []),
    ['| Group | Mean |', '| --- | ---: |', '', 'Table: Mean weight by group.', ''].join('\n'),
  );
  assert.match(renderLatex(SPEC, []), /\\toprule\nGroup & Mean \\\\\n\\midrule\n\\bottomrule/);
  assert.equal(renderCsv(SPEC, []), 'Group,Mean\n');
});

test('renderTable dispatches on the format and is deterministic', () => {
  assert.equal(renderTable(SPEC, ROWS, 'md'), renderMarkdown(SPEC, ROWS));
  assert.equal(renderTable(SPEC, ROWS, 'latex'), renderLatex(SPEC, ROWS));
  assert.equal(renderTable(SPEC, ROWS, 'csv'), renderCsv(SPEC, ROWS));
  assert.throws(() => renderTable(SPEC, ROWS, 'xlsx'), { code: 'VALIDATION' });

  for (const format of TABLE_FORMATS) {
    assert.equal(renderTable(SPEC, ROWS, format), renderTable(SPEC, ROWS, format));
  }
});

test('a cell a row never had renders as empty rather than undefined', () => {
  assert.equal(
    renderCsv(
      {
        name: 'x',
        caption: '',
        columns: [
          { key: 'a', label: 'A' },
          { key: 'b', label: 'B' },
        ],
      },
      [{ a: 1 }],
    ),
    'A,B\n1,\n',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTable, rowsFrom } from '../../src/domain/tables.js';

const here = dirname(fileURLToPath(import.meta.url));
const EXPECTED = join(here, 'expected');
const GOLDEN = { md: 'table.md', latex: 'table.tex', csv: 'table.csv' };

// The renderers are pure, so the golden runs on a fixture rather than on the example workspace:
// it pins the exact bytes a Markdown, a LaTeX and a CSV table are made of, escaping and number
// formatting included, without waiting for `scripts/make-example.mjs` to grow an analysis.
const RESULT = {
  schema: 'phdude.result',
  id: 'RESULT-0123456789',
  summary: 'Group b averages 4.1 kg more than group a.',
  values: { a: 71.4, b: 75.5, c: 68.2, 'a & b': 69.9, 'n/a': 'not measured' },
  from: 'ANALYSIS-0123456789',
};

const TABLE = {
  name: 'mean-weight',
  caption: 'Mean weight by group, in kilograms (100% of the panel).',
  columns: [
    { key: 'key', label: 'Group' },
    { key: 'value', label: 'Mean weight', format: 'number:2' },
  ],
};

test('table golden: the three renderers write exactly the committed bytes', async () => {
  const { rows } = rowsFrom({ result: RESULT.id }, { result: RESULT });

  for (const [format, file] of Object.entries(GOLDEN)) {
    const text = renderTable(TABLE, rows, format);
    const path = join(EXPECTED, file);
    if (process.env.UPDATE_GOLDEN) {
      await writeFile(path, text);
      continue;
    }
    assert.equal(text, await readFile(path, 'utf8'), `${file} drifted`);
  }
});

test('table golden: the LaTeX table escapes what LaTeX would otherwise read as markup', async () => {
  if (process.env.UPDATE_GOLDEN) return;
  const tex = await readFile(join(EXPECTED, GOLDEN.latex), 'utf8');
  assert.match(tex, /100\\% of the panel/);
  assert.match(tex, /^a \\& b & 69\.90 \\\\$/m);
  assert.doesNotMatch(tex, /[^\\]%/);
});

test('table golden: a value the format cannot read as a number is printed, not turned into NaN', async () => {
  if (process.env.UPDATE_GOLDEN) return;
  for (const file of Object.values(GOLDEN)) {
    const text = await readFile(join(EXPECTED, file), 'utf8');
    assert.match(text, /not measured/, `${file} lost the unmeasured cell`);
    assert.doesNotMatch(text, /NaN/, `${file} rendered NaN`);
  }
});

test('table golden: the Markdown table right-aligns the numeric column only', async () => {
  if (process.env.UPDATE_GOLDEN) return;
  const md = await readFile(join(EXPECTED, GOLDEN.md), 'utf8');
  assert.equal(md.split('\n')[1], '| --- | ---: |');
});

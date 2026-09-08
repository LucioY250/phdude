import { PhdudeError } from './errors.js';
import { stableStringify } from './normalize.js';

export const TABLE_FORMATS = ['md', 'latex', 'csv', 'xlsx', 'docx'];

// The formats a table renders itself, and the three a declaration takes when it names none.
// `xlsx` and `docx` are opt-in: the first is a package rather than text, and the second needs a
// renderer that may not be installed, so neither belongs in what a bare declaration promises.
export const TEXT_TABLE_FORMATS = ['md', 'latex', 'csv'];
export const DEFAULT_TABLE_FORMATS = ['md', 'latex', 'csv'];

const OUT_DIR = 'tables/out';
const EXTENSIONS = { md: 'md', latex: 'tex', csv: 'csv', xlsx: 'xlsx', docx: 'docx' };
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NUMERIC_FORMAT_RE = /^(number|percent):([0-9])$/;

/**
 * A table's name becomes a filename under `tables/out/`, so it is a slug and nothing else: a
 * name with a separator or a `..` in it would let a build write outside the workspace.
 * @param {string} input
 * @returns {string}
 */
export function tableName(input) {
  const name = String(input ?? '').trim();
  if (!NAME_RE.test(name)) {
    throw new PhdudeError(
      'VALIDATION',
      `invalid table name: ${input}`,
      'a table name is lowercase words joined by "-", e.g. mean-weight',
    );
  }
  return name;
}

/**
 * @param {string[]|undefined} formats
 * @returns {string[]} the requested formats in the canonical order, the default three when none
 *   was asked for
 */
export function tableFormats(formats) {
  if (formats === undefined || formats === null || formats.length === 0) {
    return [...DEFAULT_TABLE_FORMATS];
  }
  const unknown = [...new Set(formats)].filter((f) => !TABLE_FORMATS.includes(f)).sort();
  if (unknown.length > 0) {
    throw new PhdudeError(
      'VALIDATION',
      `unknown table format(s): ${unknown.join(', ')}`,
      `formats are ${TABLE_FORMATS.join(', ')}`,
    );
  }
  return TABLE_FORMATS.filter((f) => formats.includes(f));
}

/**
 * @param {string} name
 * @param {string[]} formats
 * @returns {Record<string, string>} format -> workspace-relative output path
 */
export function tableOutputs(name, formats) {
  return Object.fromEntries(
    tableFormats(formats).map((format) => [format, `${OUT_DIR}/${name}.${EXTENSIONS[format]}`]),
  );
}

/**
 * One cell, rendered. A value the format cannot read as a number is printed as it was written
 * rather than as `NaN`: the renderer reports the analysis, it does not correct it.
 * @param {*} value
 * @param {string} [format] - `text`, `number:<0-9>` or `percent:<0-9>`
 * @returns {string}
 */
export function formatValue(value, format) {
  if (value === undefined || value === null) return '';
  const numeric = NUMERIC_FORMAT_RE.exec(format ?? '');
  if (numeric) {
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (String(value).trim() === '' || !Number.isFinite(n)) return String(value);
    const digits = Number(numeric[2]);
    return numeric[1] === 'percent' ? `${(n * 100).toFixed(digits)}%` : n.toFixed(digits);
  }
  if (typeof value === 'object') return stableStringify(value);
  return String(value);
}

const LATEX_ESCAPES = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};

/**
 * One pass over the string, so the braces the backslash replacement introduces are not escaped
 * a second time.
 * @param {string} text
 * @returns {string}
 */
export function escapeLatex(text) {
  return String(text ?? '').replace(/[\\&%$#_{}~^]/g, (ch) => LATEX_ESCAPES[ch]);
}

function isRowObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function columnsOf(keys, labels = keys) {
  return keys.map((key, i) => ({ key, label: labels[i] }));
}

function rowsFromResult(result) {
  const values = result?.values ?? {};

  if (Array.isArray(values)) {
    const rows = values.map((entry) => (isRowObject(entry) ? entry : { value: entry }));
    const keys = [];
    for (const row of rows) {
      for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key);
    }
    if (keys.length === 1 && keys[0] === 'value') {
      return { columns: [{ key: 'value', label: 'Value' }], rows };
    }
    return { columns: columnsOf(keys), rows };
  }

  return {
    columns: [
      { key: 'key', label: 'Key' },
      { key: 'value', label: 'Value' },
    ],
    rows: Object.entries(values).map(([key, value]) => ({ key, value })),
  };
}

function rowsFromDataset(source, dataset, table) {
  const parsed = Array.isArray(table) ? table.filter(Array.isArray) : [];
  if (parsed.length === 0) {
    throw new PhdudeError(
      'VALIDATION',
      `no table to render in ${dataset?.path ?? source.dataset}`,
      'point the table at a csv, tsv, xlsx or array-of-objects json dataset',
    );
  }

  const header = parsed[0].map((cell, i) => {
    const name = String(cell ?? '').trim();
    return name === '' ? `column_${i + 1}` : name;
  });

  let keys = header;
  if (Array.isArray(source.columns) && source.columns.length > 0) {
    const missing = source.columns.filter((name) => !header.includes(name));
    if (missing.length > 0) {
      throw new PhdudeError(
        'VALIDATION',
        `${dataset?.path ?? source.dataset} has no column(s): ${missing.join(', ')}`,
        `its columns are ${header.join(', ')}`,
      );
    }
    keys = source.columns;
  }

  const body = source.limit === undefined ? parsed.slice(1) : parsed.slice(1, 1 + source.limit);
  return {
    columns: columnsOf(keys),
    rows: body.map((row) =>
      Object.fromEntries(keys.map((key) => [key, row[header.indexOf(key)] ?? ''])),
    ),
  };
}

/**
 * Pure: the rows a table's source resolves to, plus the columns to use when the table declared
 * none of its own. A RESULT's flat `values` render one row per key; an array of row objects
 * renders the rows themselves. A DATASET renders its parsed table, header first.
 * @param {{result?: string, dataset?: string, columns?: string[], limit?: number}} source
 * @param {{result?: object, dataset?: object, table?: string[][]|null}} snapshot - the source
 *   object the application read, and for a dataset the table its file parsed to
 * @returns {{columns: {key: string, label: string}[], rows: object[]}}
 */
export function rowsFrom(source, snapshot = {}) {
  const hasResult = typeof source?.result === 'string';
  const hasDataset = typeof source?.dataset === 'string';
  if (hasResult === hasDataset) {
    throw new PhdudeError(
      'VALIDATION',
      'a table source names exactly one of result or dataset',
      `source: {"result":"RESULT-…"} or {"dataset":"DATASET-…","columns":[…],"limit":n}`,
    );
  }
  return hasResult
    ? rowsFromResult(snapshot.result)
    : rowsFromDataset(source, snapshot.dataset, snapshot.table);
}

function isNumericColumn(column) {
  return NUMERIC_FORMAT_RE.test(column.format ?? '');
}

function cells(columns, row) {
  return columns.map((column) => formatValue(row[column.key], column.format));
}

function mdCell(value) {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * @param {{name?: string, caption?: string, columns: object[]}} table
 * @param {object[]} rows
 * @returns {string}
 */
export function renderMarkdown(table, rows) {
  const { columns, caption } = table;
  const lines = [
    `| ${columns.map((c) => mdCell(c.label)).join(' | ')} |`,
    `| ${columns.map((c) => (isNumericColumn(c) ? '---:' : '---')).join(' | ')} |`,
    ...rows.map((row) => `| ${cells(columns, row).map(mdCell).join(' | ')} |`),
  ];
  if (String(caption ?? '').trim() !== '') lines.push('', `Table: ${caption}`);
  return lines.join('\n') + '\n';
}

/**
 * @param {{name?: string, caption?: string, columns: object[]}} table
 * @param {object[]} rows
 * @returns {string}
 */
export function renderLatex(table, rows) {
  const { columns, caption, name } = table;
  const alignment = columns.map((c) => (isNumericColumn(c) ? 'r' : 'l')).join('');
  return (
    [
      '\\begin{table}[htbp]',
      '\\centering',
      `\\caption{${escapeLatex(caption ?? '')}}`,
      `\\label{tab:${name ?? ''}}`,
      `\\begin{tabular}{${alignment}}`,
      '\\toprule',
      `${columns.map((c) => escapeLatex(c.label)).join(' & ')} \\\\`,
      '\\midrule',
      ...rows.map((row) => `${cells(columns, row).map(escapeLatex).join(' & ')} \\\\`),
      '\\bottomrule',
      '\\end{tabular}',
      '\\end{table}',
    ].join('\n') + '\n'
  );
}

function csvField(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * @param {{columns: object[]}} table
 * @param {object[]} rows
 * @returns {string}
 */
export function renderCsv(table, rows) {
  const { columns } = table;
  return (
    [
      columns.map((c) => csvField(c.label)).join(','),
      ...rows.map((row) => cells(columns, row).map(csvField).join(',')),
    ].join('\n') + '\n'
  );
}

// A spreadsheet cell that a column's format reads as a number is written as a number, so the
// spreadsheet can compute with it; a percent column carries the number the other formats print,
// without the sign. A value that already is a number stays one. A string is left a string even
// when it looks numeric: "007" is an identifier in some datasets and 7 in none of them.
function sheetCell(value, format) {
  const text = formatValue(value, format);
  if (!NUMERIC_FORMAT_RE.test(format ?? '')) {
    return typeof value === 'number' && Number.isFinite(value) ? value : text;
  }
  const n = Number(text.endsWith('%') ? text.slice(0, -1) : text);
  return text !== '' && Number.isFinite(n) ? n : text;
}

/**
 * The one sheet a table becomes: the column labels, then one row per record. The caption is not
 * a row - a spreadsheet's first row is its header, and a title above it would displace every
 * reader that expects one.
 * @param {{name?: string, columns: object[]}} table
 * @param {object[]} rows
 * @returns {{name: string, rows: (string|number)[][]}}
 */
export function tableSheet(table, rows) {
  const { columns, name } = table;
  return {
    name: name ?? 'Sheet1',
    rows: [
      columns.map((c) => c.label),
      ...rows.map((row) => columns.map((c) => sheetCell(row[c.key], c.format))),
    ],
  };
}

const RENDERERS = { md: renderMarkdown, latex: renderLatex, csv: renderCsv };

/**
 * @param {{name?: string, caption?: string, columns: object[]}} table
 * @param {object[]} rows
 * @param {'md'|'latex'|'csv'} format
 * @returns {string}
 */
export function renderTable(table, rows, format) {
  const render = RENDERERS[format];
  if (!render) {
    throw new PhdudeError(
      'VALIDATION',
      TABLE_FORMATS.includes(format)
        ? `${format} is not text: it is written as a file, not rendered`
        : `unknown table format: ${format}`,
      `text formats are ${TEXT_TABLE_FORMATS.join(', ')}`,
    );
  }
  return render(table, rows);
}

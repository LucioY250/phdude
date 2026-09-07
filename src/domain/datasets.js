import { isAbsolute, normalize, sep } from 'node:path';
import { PhdudeError } from './errors.js';

const DATA_DIR = 'data/';
const MAX_DISTINCT = 50;
const MAX_SAMPLES = 5;

const FORMAT_BY_EXT = { csv: 'csv', tsv: 'tsv', json: 'json', xlsx: 'xlsx' };

const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const BOOLEAN_RE = /^(?:true|false|yes|no)$/i;
const DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * A dataset's path comes from a researcher's command line and is written into a record other
 * commands will read files from, so it has to stay inside `data/`: a `../` in it would let a
 * later run read and hash a file outside the workspace.
 * @param {string} input
 * @returns {string} the path with `/` separators, relative to the workspace root
 */
export function datasetPath(input) {
  const text = String(input ?? '').trim();
  const rel = text === '' ? '' : normalize(text).split(sep).join('/');
  const inside =
    text !== '' &&
    !isAbsolute(text) &&
    rel.startsWith(DATA_DIR) &&
    rel.length > DATA_DIR.length &&
    !rel.split('/').includes('..');
  if (!inside) {
    throw new PhdudeError(
      'VALIDATION',
      `dataset path outside data/: ${input}`,
      'a dataset path looks like data/survey.csv',
    );
  }
  return rel;
}

/**
 * @param {string} path
 * @returns {string} csv, tsv, json, xlsx or other
 */
export function datasetFormat(path) {
  const base = String(path ?? '')
    .split('/')
    .pop();
  const i = base.lastIndexOf('.');
  const ext = i <= 0 ? '' : base.slice(i + 1).toLowerCase();
  return FORMAT_BY_EXT[ext] ?? 'other';
}

function cellText(value) {
  return value === undefined || value === null ? '' : String(value);
}

function headerName(cell, index) {
  const name = cellText(cell).trim();
  return name === '' ? `column_${index + 1}` : name;
}

// Number before boolean before date, so a column of 0s and 1s is reported as the numbers it
// holds rather than as the booleans a reader might have meant. Widening in the other direction
// would be a guess about intent; this is only a report of what is in the cells.
function inferType(present) {
  if (present.length === 0) return 'empty';
  if (present.every((v) => NUMBER_RE.test(v))) return 'number';
  if (present.every((v) => BOOLEAN_RE.test(v))) return 'boolean';
  if (present.every((v) => DATE_RE.test(v))) return 'date';
  return 'string';
}

function profileColumn(name, cells, sensitive) {
  const values = cells.map((cell) => cellText(cell).trim());
  const present = values.filter((v) => v !== '');
  const distinct = [...new Set(present)];
  const column = {
    name,
    inferred_type: inferType(present),
    missing: values.length - present.length,
    distinct: Math.min(distinct.length, MAX_DISTINCT),
    distinct_truncated: distinct.length > MAX_DISTINCT,
  };
  // A sensitive dataset gets counts and types but no cell content: the profile is committed to
  // the repository, and a sample of five values is enough to leak the column it came from.
  if (!sensitive) column.samples = distinct.slice(0, MAX_SAMPLES);
  return column;
}

/**
 * Pure: the deterministic profile of a parsed table whose first row is its header. Columns are
 * the header's; a data row shorter than the header contributes a missing cell rather than
 * changing the column list, and anything past the header's width is not a column.
 * @param {string[][]|null} rows
 * @param {{sensitive?: boolean}} [opts]
 * @returns {{rows: number, columns: object[]}}
 */
export function profileTable(rows, { sensitive = false } = {}) {
  const table = Array.isArray(rows) ? rows.filter(Array.isArray) : [];
  if (table.length === 0) return { rows: 0, columns: [] };
  const header = table[0];
  const body = table.slice(1);
  return {
    rows: body.length,
    columns: header.map((cell, i) =>
      profileColumn(
        headerName(cell, i),
        body.map((row) => row[i]),
        sensitive,
      ),
    ),
  };
}

/**
 * Pure: links a new dataset to the ones already recorded at the same path, the way artifacts
 * link versions (`domain/versions.js`) - every later version points at the oldest, and only the
 * newest is `latest`.
 * @param {object[]} existing - datasets already at this path, oldest first
 * @param {object} next
 * @returns {{dataset: object, updated: object[]}} `updated` are the existing records to rewrite
 */
export function linkDatasetVersions(existing, next) {
  if (existing.length === 0) return { dataset: next, updated: [] };
  const root = existing.find((d) => d.versions_of === undefined) ?? existing[0];
  return {
    dataset: { ...next, versions_of: root.id, latest: true },
    updated: existing.filter((d) => d.latest !== false).map((d) => ({ ...d, latest: false })),
  };
}

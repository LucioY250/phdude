import { textParser } from './text.js';
import { ooxmlParser } from './ooxml.js';
import { pdfParser } from './pdf.js';

export const PARSERS = [textParser, ooxmlParser, pdfParser];

const EXT_KIND = { txt: 'txt', md: 'md', csv: 'csv', bib: 'bib', tex: 'tex' };

function extOf(path) {
  const i = path.lastIndexOf('.');
  return i === -1 ? '' : path.slice(i + 1).toLowerCase();
}

/**
 * Detects a document kind from magic bytes, falling back to the file
 * extension when the bytes are not recognized.
 * @param {Buffer|Uint8Array} buffer
 * @param {string} [path]
 * @returns {string}
 */
export function detectKind(buffer, path = '') {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const ext = extOf(path);

  if (buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';

  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx') return ext;
    return 'other';
  }

  return EXT_KIND[ext] ?? 'other';
}

/**
 * @param {string} kind
 * @returns {import('../../ports/document-parser.js').DocumentParser | null}
 */
export function parserFor(kind) {
  return PARSERS.find((p) => p.kinds.includes(kind)) ?? null;
}

function parseDelimited(text, separator) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.split(separator));
}

// An array of objects is the only JSON shape that is a table: its keys are the columns, in the
// order they first appear, and a key an object does not carry is a missing cell. Anything else
// (a bare object, an array of scalars) is data PhDude will record and hash but not profile.
function parseJsonRows(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;
  if (!data.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row))) {
    return null;
  }
  const keys = [];
  for (const row of data) {
    for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key);
  }
  return [keys, ...data.map((row) => keys.map((key) => jsonCell(row[key])))];
}

function jsonCell(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * The tabular reading of a data file, for `application/data.js` to profile: the first row is the
 * header. `null` means the format carries no table this build can read, which is a profile of
 * zero columns rather than an error.
 * @param {Buffer|Uint8Array} bytes
 * @param {string} format - csv, tsv, json, xlsx or other
 * @returns {Promise<string[][]|null>}
 */
export async function parseTable(bytes, format) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (format === 'csv') {
    return (await textParser.parse(buf, { path: 'table.csv' })).tables[0]?.rows ?? [];
  }
  if (format === 'tsv') return parseDelimited(buf.toString('utf8'), '\t');
  if (format === 'xlsx') {
    return (await ooxmlParser.parse(buf, { path: 'table.xlsx' })).tables[0]?.rows ?? [];
  }
  if (format === 'json') return parseJsonRows(buf.toString('utf8'));
  return null;
}

import { zipSync, strToU8 } from 'fflate';
import { PhdudeError } from '../../domain/errors.js';

// Every part is written from the same fixed timestamp, so the same rows always produce the same
// file. A build compares the bytes it would write against the bytes on disk to decide whether it
// has anything to do; a clock in the zip header would make every rebuild look like a change.
const FIXED_MTIME = new Date(Date.UTC(2000, 0, 1));

const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const SPREADSHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

const SHEET_NAME_LIMIT = 31;
const FORBIDDEN_IN_SHEET_NAME = /[\\/:*?[\]]/g;

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

// XML 1.0 has no way to write most of the ASCII control characters, and a cell that carries one
// out of a badly exported file would make the whole workbook unopenable. Tabs and newlines are
// legal and kept; the rest are dropped.
function printable(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x20 || code === 0x09 || code === 0x0a) out += text[i];
  }
  return out;
}

function escapeXml(text) {
  return printable(String(text)).replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]);
}

/**
 * @param {number} index - zero-based
 * @returns {string} the spreadsheet column letters: A, B, … Z, AA, AB
 */
export function columnRef(index) {
  let ref = '';
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    ref = String.fromCharCode(65 + (n % 26)) + ref;
  }
  return ref;
}

// A sheet name a reader would refuse is trimmed rather than passed through: the file name still
// carries the table's full name, and a workbook that will not open carries nothing at all.
function sheetName(name, index) {
  const cleaned = printable(String(name ?? ''))
    .replace(FORBIDDEN_IN_SHEET_NAME, '-')
    .trim()
    .slice(0, SHEET_NAME_LIMIT);
  return cleaned === '' ? `Sheet${index + 1}` : cleaned;
}

function cellXml(ref, value, strings) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" t="n"><v>${value}</v></c>`;
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  let index = strings.get(text);
  if (index === undefined) {
    index = strings.size;
    strings.set(text, index);
  }
  return `<c r="${ref}" t="s"><v>${index}</v></c>`;
}

function sheetXml(rows, strings) {
  const body = rows
    .map((row, r) => {
      const cells = (Array.isArray(row) ? row : [row])
        .map((value, c) => cellXml(`${columnRef(c)}${r + 1}`, value, strings))
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return `${HEADER}<worksheet xmlns="${MAIN}"><sheetData>${body}</sheetData></worksheet>`;
}

function sharedStringsXml(strings) {
  const items = [...strings.keys()]
    .map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`)
    .join('');
  const count = strings.size;
  return `${HEADER}<sst xmlns="${MAIN}" count="${count}" uniqueCount="${count}">${items}</sst>`;
}

function workbookXml(names) {
  const sheets = names
    .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return (
    `${HEADER}<workbook xmlns="${MAIN}" xmlns:r="${DOC_REL}">` +
    `<sheets>${sheets}</sheets></workbook>`
  );
}

function workbookRelsXml(count) {
  const rels = [
    ...Array.from(
      { length: count },
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="${DOC_REL}/worksheet" ` +
        `Target="worksheets/sheet${i + 1}.xml"/>`,
    ),
    `<Relationship Id="rId${count + 1}" Type="${DOC_REL}/sharedStrings" Target="sharedStrings.xml"/>`,
    `<Relationship Id="rId${count + 2}" Type="${DOC_REL}/styles" Target="styles.xml"/>`,
  ].join('');
  return `${HEADER}<Relationships xmlns="${PKG_REL}">${rels}</Relationships>`;
}

function contentTypesXml(count) {
  const overrides = [
    `<Override PartName="/xl/workbook.xml" ContentType="${SPREADSHEET}.sheet.main+xml"/>`,
    ...Array.from(
      { length: count },
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
        `ContentType="${SPREADSHEET}.worksheet+xml"/>`,
    ),
    `<Override PartName="/xl/sharedStrings.xml" ContentType="${SPREADSHEET}.sharedStrings+xml"/>`,
    `<Override PartName="/xl/styles.xml" ContentType="${SPREADSHEET}.styles+xml"/>`,
  ].join('');
  return (
    `${HEADER}<Types xmlns="${CONTENT_TYPES}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `${overrides}</Types>`
  );
}

const ROOT_RELS =
  `${HEADER}<Relationships xmlns="${PKG_REL}">` +
  `<Relationship Id="rId1" Type="${DOC_REL}/officeDocument" Target="xl/workbook.xml"/>` +
  '</Relationships>';

// One font, one fill pair and one cell format: the minimum a reader needs to lay out a cell.
// PhDude writes data, not formatting, so there is nothing else to say here.
const STYLES =
  `${HEADER}<styleSheet xmlns="${MAIN}">` +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
  '</styleSheet>';

/**
 * A minimal SpreadsheetML workbook, written here rather than through an external tool: a table
 * is data, and asking a researcher to install one to get an `.xlsx` out of a number PhDude
 * already holds would be a tool requirement for nothing.
 * @param {{sheets: {name: string, rows: (string|number|boolean|null)[][]}[]}} workbook
 * @returns {Buffer} the `.xlsx` package
 */
export function writeXlsx({ sheets } = {}) {
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new PhdudeError(
      'VALIDATION',
      'a workbook needs at least one sheet',
      'writeXlsx({ sheets: [{ name, rows }] })',
    );
  }

  const strings = new Map();
  const names = sheets.map((sheet, i) => sheetName(sheet.name, i));
  const worksheets = sheets.map((sheet) => sheetXml(sheet.rows ?? [], strings));

  const files = {
    '[Content_Types].xml': strToU8(contentTypesXml(sheets.length)),
    '_rels/.rels': strToU8(ROOT_RELS),
    'xl/workbook.xml': strToU8(workbookXml(names)),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRelsXml(sheets.length)),
    'xl/styles.xml': strToU8(STYLES),
    // The shared string table is written last because the worksheets fill it as they render.
    'xl/sharedStrings.xml': strToU8(sharedStringsXml(strings)),
  };
  for (const [i, xml] of worksheets.entries()) {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml);
  }

  return Buffer.from(zipSync(files, { level: 9, mtime: FIXED_MTIME }));
}

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

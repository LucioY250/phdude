#!/usr/bin/env node
// Generates the deterministic fixtures used by the document parser tests.
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'tests', 'fixtures', 'docs');

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '</Types>';

const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';

// DOS zip timestamps only cover 1980-2099; pin to the earliest valid date so
// re-running this script never produces a spurious byte diff.
const FIXED_MTIME = new Date('1980-01-01T00:00:00Z');

function zipOf(files) {
  const entries = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] = [strToU8(content), { mtime: FIXED_MTIME }];
  }
  return Buffer.from(zipSync(entries));
}

function buildDocx() {
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Methods</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Sample size</w:t></w:r><w:r><w:tab/></w:r>' +
    '<w:r><w:t>was 312 participants recruited from the general population.</w:t></w:r>' +
    '<w:r><w:br/></w:r><w:r><w:t>Second line.</w:t></w:r></w:p>' +
    '<w:tbl>' +
    '<w:tr><w:tc><w:p><w:r><w:t>Group</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>N</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>Control</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>156</w:t></w:r></w:p></w:tc></w:tr>' +
    '</w:tbl>' +
    '</w:body>' +
    '</w:document>';

  return zipOf({
    '[Content_Types].xml': CONTENT_TYPES_XML,
    '_rels/.rels': ROOT_RELS_XML,
    'word/document.xml': documentXml,
  });
}

function buildPptx() {
  const slideXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld><p:spTree>' +
    '<p:sp><p:txBody>' +
    '<a:p><a:r><a:t>We recruited </a:t></a:r><a:r><a:t>300 participants</a:t></a:r></a:p>' +
    '<a:p><a:r><a:t>Across two </a:t></a:r><a:r><a:t>study sites.</a:t></a:r></a:p>' +
    '</p:txBody></p:sp>' +
    '</p:spTree></p:cSld>' +
    '</p:sld>';

  return zipOf({
    '[Content_Types].xml': CONTENT_TYPES_XML,
    '_rels/.rels': ROOT_RELS_XML,
    'ppt/slides/slide1.xml': slideXml,
  });
}

function buildXlsx() {
  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheets><sheet name="Sheet1" sheetId="1"/></sheets>' +
    '</workbook>';

  const sheetXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>' +
    '<row r="1"><c r="A1" t="inlineStr"><is><t>metric</t></is></c>' +
    '<c r="B1" t="inlineStr"><is><t>value</t></is></c></row>' +
    '<row r="2"><c r="A2" t="inlineStr"><is><t>sample_size</t></is></c>' +
    '<c r="B2" t="inlineStr"><is><t>312</t></is></c></row>' +
    '</sheetData>' +
    '</worksheet>';

  return zipOf({
    '[Content_Types].xml': CONTENT_TYPES_XML,
    '_rels/.rels': ROOT_RELS_XML,
    'xl/workbook.xml': workbookXml,
    'xl/worksheets/sheet1.xml': sheetXml,
  });
}

// Builds a minimal, structurally correct single-page PDF (header, catalog,
// pages, page, content stream, font resource, xref, trailer) with byte-exact
// xref offsets, containing the literal text "Hello PhDude".
function buildPdf() {
  const streamContent = 'BT /F1 24 Tf 72 720 Td (Hello PhDude) Tj ET';
  const objectBodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> ' +
      '/MediaBox [0 0 612 792] /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(streamContent, 'latin1')} >>\nstream\n${streamContent}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 0; i < objectBodies.length; i++) {
    offsets[i + 1] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i + 1} 0 obj\n${objectBodies[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  const count = objectBodies.length + 1;
  pdf += `xref\n0 ${count}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < count; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

/**
 * Builds every fixture buffer deterministically. Pure and side-effect free so
 * it can be re-run in a test and compared byte-for-byte against the
 * committed fixtures on disk.
 * @returns {Record<string, Buffer>}
 */
export function buildFixtures() {
  return {
    'sample.txt': Buffer.from(
      'PhDude is a field-agnostic research co-author harness for AI coding agents.\n',
      'utf8',
    ),
    'sample.md': Buffer.from(
      '# Introduction\n\nThis study examines the fixture parser contract.\n\n' +
        '# Background\n\nPrior work established the baseline document format.\n',
      'utf8',
    ),
    'sample.csv': Buffer.from(
      'metric,value,unit\nsample_size,312,participants\nresponse_rate,87.5,percent\n',
      'utf8',
    ),
    'sample.docx': buildDocx(),
    'sample.pptx': buildPptx(),
    'sample.xlsx': buildXlsx(),
    'sample.pdf': buildPdf(),
  };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const files = buildFixtures();
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(outDir, name), content);
    console.log(`wrote ${name} (${content.length} bytes)`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pdfParser } from '../../src/adapters/documents/pdf.js';

const PAGES = 600;
const LINES_PER_PAGE = 25;
const LINE = 'Participants were recruited across three campuses and reported daily app use again';

function contentStream(pageIndex) {
  const lines = ['BT /F1 9 Tf 36 756 Td 11 TL'];
  for (let i = 0; i < LINES_PER_PAGE; i++) {
    lines.push(`(${LINE} p${pageIndex} l${i}) Tj T*`);
  }
  lines.push('ET');
  return lines.join('\n');
}

// A structurally correct multi-page PDF with byte-exact xref offsets, built the same way as
// scripts/make-fixtures.mjs builds the single-page fixture. Extracted text is deliberately
// larger than execFile's 1 MiB default stdout buffer.
function buildLargePdf() {
  const bodies = [null, null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const pageObjNums = [];

  for (let p = 0; p < PAGES; p++) {
    const pageNum = bodies.length + 1;
    const contentNum = pageNum + 1;
    pageObjNums.push(pageNum);
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> ` +
        `/MediaBox [0 0 612 792] /Contents ${contentNum} 0 R >>`,
    );
    const stream = contentStream(p);
    bodies.push(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
  }

  bodies[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  bodies[1] =
    `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] ` +
    `/Count ${PAGES} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 0; i < bodies.length; i++) {
    offsets[i + 1] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i + 1} 0 obj\n${bodies[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  const count = bodies.length + 1;
  pdf += `xref\n0 ${count}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < count; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

test('pdf parser extracts a thesis-sized document whose text exceeds 1 MiB', async (t) => {
  if (!(await pdfParser.available())) {
    t.skip('pdftotext is not installed');
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), 'phdude-pdf-large-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'thesis.pdf');
  const buffer = buildLargePdf();
  await writeFile(path, buffer);

  const result = await pdfParser.parse(buffer, { path });

  assert.deepEqual(result.warnings, [], 'a readable PDF must not warn');
  assert.ok(
    result.text.length > 1_048_576,
    `extracted text should exceed execFile's 1 MiB default, got ${result.text.length}`,
  );
  assert.equal(result.sections.length, PAGES, 'one section per page');
  // ingest derives extracted.status from the character count: > 0 means "ok".
  assert.ok(result.text.length > 0, 'extraction status would be ok');
});

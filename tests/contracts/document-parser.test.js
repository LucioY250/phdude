import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { documentParserContract } from '../../src/ports/document-parser.js';
import { textParser } from '../../src/adapters/documents/text.js';
import { ooxmlParser } from '../../src/adapters/documents/ooxml.js';
import { pdfParser } from '../../src/adapters/documents/pdf.js';
const fx = (n) => readFile(new URL(`../fixtures/docs/${n}`, import.meta.url));

documentParserContract(test, assert, textParser, [['sample.md', fx('sample.md')]]);
documentParserContract(test, assert, ooxmlParser, [
  ['sample.docx', fx('sample.docx')],
  ['sample.pptx', fx('sample.pptx')],
  ['sample.xlsx', fx('sample.xlsx')],
]);

test('markdown sections split on headings', async () => {
  const r = await textParser.parse(await fx('sample.md'), { path: 'sample.md' });
  assert.equal(r.sections.length, 2);
  assert.equal(r.sections[0].title, 'Introduction');
});
test('csv becomes one table', async () => {
  const r = await textParser.parse(await fx('sample.csv'), { path: 'sample.csv' });
  assert.equal(r.tables[0].rows[0].length, 3);
});
test('docx yields headings, text and a table', async () => {
  const r = await ooxmlParser.parse(await fx('sample.docx'), { path: 'sample.docx' });
  assert.match(r.text, /Sample size was 312/);
  assert.equal(r.sections[0].title, 'Methods');
  assert.equal(r.tables.length, 1);
});
test('pptx yields one section per slide', async () => {
  const r = await ooxmlParser.parse(await fx('sample.pptx'), { path: 'sample.pptx' });
  assert.equal(r.sections[0].title, 'Slide 1');
  assert.match(r.text, /300 participants/);
});
test('xlsx yields one table per sheet', async () => {
  const r = await ooxmlParser.parse(await fx('sample.xlsx'), { path: 'sample.xlsx' });
  assert.deepEqual(r.tables[0].rows[0], ['metric', 'value']);
});
test('pdf parser extracts text when pdftotext is available, else reports unavailable', async () => {
  const r = await pdfParser.parse(await fx('sample.pdf'), { path: 'sample.pdf' });
  if (await pdfParser.available()) assert.match(r.text, /Hello PhDude/);
  else assert.ok(r.warnings.some((w) => /pdftotext/.test(w)));
});

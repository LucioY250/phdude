import test from 'node:test';
import assert from 'node:assert/strict';
import { detectKind } from '../../../src/adapters/documents/index.js';

const PDF_MAGIC = Buffer.from('%PDF-1.4\n%rest of file', 'latin1');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const PLAIN = Buffer.from('just some plain bytes, not a pdf or zip', 'utf8');

test('magic %PDF bytes detect as pdf regardless of extension', () => {
  assert.equal(detectKind(PDF_MAGIC, 'sample.pdf'), 'pdf');
  assert.equal(detectKind(PDF_MAGIC, 'sample.bin'), 'pdf');
});

test('zip magic bytes detect docx/pptx/xlsx by extension', () => {
  assert.equal(detectKind(ZIP_MAGIC, 'sample.docx'), 'docx');
  assert.equal(detectKind(ZIP_MAGIC, 'sample.pptx'), 'pptx');
  assert.equal(detectKind(ZIP_MAGIC, 'sample.xlsx'), 'xlsx');
});

test('zip magic bytes with an unrecognized extension fall back to other', () => {
  assert.equal(detectKind(ZIP_MAGIC, 'sample.zip'), 'other');
});

test('non-magic buffers are classified by extension', () => {
  assert.equal(detectKind(PLAIN, 'notes.txt'), 'txt');
  assert.equal(detectKind(PLAIN, 'notes.md'), 'md');
  assert.equal(detectKind(PLAIN, 'data.csv'), 'csv');
  assert.equal(detectKind(PLAIN, 'refs.bib'), 'bib');
  assert.equal(detectKind(PLAIN, 'paper.tex'), 'tex');
});

test('unknown extension with no magic bytes is other', () => {
  assert.equal(detectKind(PLAIN, 'archive.7z'), 'other');
  assert.equal(detectKind(PLAIN, 'noextension'), 'other');
});

test('a .docx extension on a non-zip buffer is other, not docx', () => {
  assert.equal(detectKind(PLAIN, 'fake.docx'), 'other');
});

test('a .pdf extension on non-PDF bytes is other, not pdf', () => {
  assert.equal(detectKind(PLAIN, 'fake.pdf'), 'other');
});

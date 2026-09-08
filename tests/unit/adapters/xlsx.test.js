import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { writeXlsx } from '../../../src/adapters/render/xlsx.js';
import { ooxmlParser } from '../../../src/adapters/documents/ooxml.js';
import { PhdudeError } from '../../../src/domain/errors.js';

const SHEET = {
  name: 'mean-weight',
  rows: [
    ['Group', 'Mean weight'],
    ['a', 71.4],
    ['b & c', 75.5],
    ['n/a', 'not measured'],
  ],
};

function partsOf(buffer) {
  return unzipSync(new Uint8Array(buffer));
}

function textOfPart(buffer, name) {
  const part = partsOf(buffer)[name];
  assert.ok(part, `${name} is missing from the package`);
  return strFromU8(part);
}

test('the workbook carries every part a spreadsheet reader opens', () => {
  const buffer = writeXlsx({ sheets: [SHEET] });
  assert.deepEqual(Object.keys(partsOf(buffer)).sort(), [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/_rels/workbook.xml.rels',
    'xl/sharedStrings.xml',
    'xl/styles.xml',
    'xl/workbook.xml',
    'xl/worksheets/sheet1.xml',
  ]);
});

test('a string cell is shared and a number cell is typed as a number', () => {
  const buffer = writeXlsx({ sheets: [SHEET] });
  const sheet = textOfPart(buffer, 'xl/worksheets/sheet1.xml');

  assert.match(sheet, /<c r="A1" t="s"><v>0<\/v><\/c>/);
  assert.match(sheet, /<c r="B2" t="n"><v>71\.4<\/v><\/c>/);
  assert.match(sheet, /<row r="4">/);

  const shared = textOfPart(buffer, 'xl/sharedStrings.xml');
  assert.match(shared, /uniqueCount="6"/);
  assert.match(shared, /<si><t xml:space="preserve">Group<\/t><\/si>/);
});

test('a string that would break the XML is escaped, not dropped', () => {
  const buffer = writeXlsx({ sheets: [{ name: 'esc', rows: [['a & <b>', '"q"']] }] });
  const shared = textOfPart(buffer, 'xl/sharedStrings.xml');
  assert.match(shared, /a &amp; &lt;b&gt;/);
  assert.doesNotMatch(shared, /<b>/);
});

test('an empty cell is left out and the cells after it keep their column', () => {
  const buffer = writeXlsx({ sheets: [{ name: 'gaps', rows: [['a', '', 'c']] }] });
  const sheet = textOfPart(buffer, 'xl/worksheets/sheet1.xml');
  assert.doesNotMatch(sheet, /r="B1"/);
  assert.match(sheet, /<c r="C1" t="s">/);
});

test('the workbook reopens through the OOXML parser with its values intact', async () => {
  const buffer = writeXlsx({ sheets: [SHEET] });
  const parsed = await ooxmlParser.parse(buffer, { path: 'mean-weight.xlsx' });

  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.tables.length, 1);
  assert.equal(parsed.tables[0].name, 'mean-weight');
  assert.deepEqual(parsed.tables[0].rows, [
    ['Group', 'Mean weight'],
    ['a', '71.4'],
    ['b & c', '75.5'],
    ['n/a', 'not measured'],
  ]);
});

test('two sheets are two worksheets, named in the workbook in the order they were given', () => {
  const buffer = writeXlsx({
    sheets: [
      { name: 'first', rows: [['a']] },
      { name: 'second', rows: [['b']] },
    ],
  });
  const parts = partsOf(buffer);
  assert.ok(parts['xl/worksheets/sheet2.xml'], 'the second worksheet is missing');

  const workbook = textOfPart(buffer, 'xl/workbook.xml');
  assert.match(workbook, /<sheet name="first" sheetId="1" r:id="rId1"\/>/);
  assert.match(workbook, /<sheet name="second" sheetId="2" r:id="rId2"\/>/);

  const rels = textOfPart(buffer, 'xl/_rels/workbook.xml.rels');
  assert.match(rels, /Id="rId3"[^>]*Target="sharedStrings\.xml"/);
  assert.match(rels, /Id="rId4"[^>]*Target="styles\.xml"/);
});

test('a column past Z gets a two-letter reference', () => {
  const rows = [Array.from({ length: 28 }, (_, i) => i + 1)];
  const sheet = textOfPart(
    writeXlsx({ sheets: [{ name: 'wide', rows }] }),
    'xl/worksheets/sheet1.xml',
  );
  assert.match(sheet, /<c r="Z1" t="n"><v>26<\/v><\/c>/);
  assert.match(sheet, /<c r="AA1" t="n"><v>27<\/v><\/c>/);
  assert.match(sheet, /<c r="AB1" t="n"><v>28<\/v><\/c>/);
});

// The bytes are what a build hashes to decide it is up to date, so the same rows written twice
// have to be the same file: a timestamp taken from the clock would make every rebuild look new.
test('the same rows written twice are the same bytes', () => {
  const first = writeXlsx({ sheets: [SHEET] });
  const second = writeXlsx({ sheets: [SHEET] });
  assert.ok(first.equals(second), 'two writes of the same workbook differ');
});

test('a sheet name a spreadsheet cannot hold is trimmed to one it can', () => {
  const buffer = writeXlsx({ sheets: [{ name: 'a/b:c*d?e[f]g'.padEnd(40, 'x'), rows: [['v']] }] });
  const workbook = textOfPart(buffer, 'xl/workbook.xml');
  const name = /<sheet name="([^"]*)"/.exec(workbook)[1];
  assert.equal(name.length, 31);
  assert.doesNotMatch(name, /[/\\:*?[\]]/);
});

test('a workbook with no sheets is a validation error, not an empty file', () => {
  assert.throws(() => writeXlsx({ sheets: [] }), PhdudeError);
  assert.throws(() => writeXlsx({}), PhdudeError);
});

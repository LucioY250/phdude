import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { zipSync, strToU8 } from 'fflate';
import { ooxmlStyleNames } from '../../../src/adapters/documents/ooxml.js';
import { missingStyles } from '../../../src/domain/templates.js';
import { PhdudeError } from '../../../src/domain/errors.js';

const run = promisify(execFile);

function docx(stylesXml) {
  return Buffer.from(
    zipSync({
      'word/document.xml': strToU8('<w:document/>'),
      ...(stylesXml === null ? {} : { 'word/styles.xml': strToU8(stylesXml) }),
    }),
  );
}

test('every style id and every style name the template declares is reported', () => {
  const buffer = docx(
    '<w:styles><w:style w:type="paragraph" w:styleId="Heading1">' +
      '<w:name w:val="heading 1"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Caption"/></w:styles>',
  );
  assert.deepEqual(ooxmlStyleNames(buffer), [
    'Heading1',
    'heading 1',
    'BodyText',
    'Body Text',
    'Caption',
  ]);
});

test('a package with no styles part reports no styles rather than throwing', () => {
  assert.deepEqual(ooxmlStyleNames(docx(null)), []);
});

test('bytes that are not a package at all are a validation error', () => {
  assert.throws(() => ooxmlStyleNames(Buffer.from('not a zip')), PhdudeError);
});

// The template a researcher is most likely to start from is the one Pandoc ships, so the check
// has to agree with it: Pandoc names the heading styles "heading 1", not "Heading 1".
test('the reference DOCX Pandoc ships passes the style check', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-ooxml-'));
  const path = join(root, 'reference.docx');
  try {
    const { stdout } = await run('pandoc', ['--print-default-data-file', 'reference.docx'], {
      encoding: 'buffer',
      maxBuffer: 32 * 1024 * 1024,
    });
    await writeFile(path, stdout);
  } catch {
    t.skip('pandoc is not installed');
    return;
  }
  assert.deepEqual(missingStyles(ooxmlStyleNames(await readFile(path))), []);
});

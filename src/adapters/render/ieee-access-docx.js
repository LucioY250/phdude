import { readFile, writeFile } from 'node:fs/promises';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PhdudeError } from '../../domain/errors.js';

const FIXED_MTIME = new Date(Date.UTC(2000, 0, 1));
// Half-points: the official IEEE Access template's body PARA/Text style is 10 pt.
const BODY_SIZE = '20';

function fail(message) {
  throw new PhdudeError(
    'EXECUTION',
    `cannot apply IEEE Access DOCX layout: ${message}`,
    'check that the registered IEEE Access reference document is compatible with Pandoc',
  );
}

function sectionParts(section, names) {
  return names.map((name) => section.match(new RegExp(`<w:${name}\\b[^>]*/>`))?.[0] ?? '').join('');
}

function twoColumns(section) {
  const columns = '<w:cols w:num="2" w:space="400"/>';
  let updated = /<w:cols\b[^>]*\/>/.test(section)
    ? section.replace(/<w:cols\b[^>]*\/>/, columns)
    : section.replace('</w:sectPr>', `${columns}</w:sectPr>`);
  const type = '<w:type w:val="continuous"/>';
  updated = /<w:type\b[^>]*\/>/.test(updated)
    ? updated.replace(/<w:type\b[^>]*\/>/, type)
    : updated.replace(
        /(<w:sectPr\b[^>]*>(?:\s*<w:(?:headerReference|footerReference)\b[^>]*\/>\s*)*)/,
        `$1${type}`,
      );
  return updated;
}

function sizeStyle(styles, id) {
  const pattern = new RegExp(`<w:style\\b(?=[^>]*w:styleId="${id}")[\\s\\S]*?</w:style>`);
  return styles.replace(pattern, (style) => {
    const sizes = `<w:sz w:val="${BODY_SIZE}"/><w:szCs w:val="${BODY_SIZE}"/>`;
    if (/<w:rPr>[\s\S]*?<\/w:rPr>/.test(style)) {
      return style.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/, (_, contents) => {
        const clean = contents.replace(/<w:sz(?:Cs)?\b[^>]*\/>/g, '');
        return `<w:rPr>${clean}${sizes}</w:rPr>`;
      });
    }
    return style.replace('</w:style>', `<w:rPr>${sizes}</w:rPr></w:style>`);
  });
}

export function ieeeAccessDocumentXml(document) {
  const sections = [...document.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)];
  if (sections.length === 0) fail('rendered document has no section properties');
  const last = sections.at(-1);
  const bodyHeading =
    /<w:p\b(?=(?:(?!<\/w:p>)[\s\S])*?<w:pStyle\s+w:val="Heading1"\s*\/>)[\s\S]*?<\/w:p>/g.exec(
      document,
    );
  if (!bodyHeading) fail('rendered document has no body Heading1');

  const geometry = sectionParts(last[0], ['pgSz', 'pgMar']);
  const grid = sectionParts(last[0], ['docGrid']);
  const front = `<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/>${geometry}<w:cols w:num="1"/>${grid}</w:sectPr></w:pPr></w:p>`;
  let updated = document.slice(0, bodyHeading.index) + front + document.slice(bodyHeading.index);
  const shiftedLast = last.index + front.length;
  updated =
    updated.slice(0, shiftedLast) +
    twoColumns(last[0]) +
    updated.slice(shiftedLast + last[0].length);
  return updated;
}

export function ieeeAccessStylesXml(styles) {
  if (!/<w:style\b(?=[^>]*w:styleId="Normal")/.test(styles)) {
    fail('rendered document has no Normal paragraph style');
  }
  const normal = sizeStyle(styles, 'Normal');
  return sizeStyle(normal, 'FirstParagraph');
}

export async function formatIeeeAccessDocx(path) {
  let files;
  try {
    files = unzipSync(new Uint8Array(await readFile(path)));
  } catch {
    fail('rendered file is not a readable DOCX package');
  }
  if (!files['word/document.xml'] || !files['word/styles.xml']) {
    fail('rendered package lacks document.xml or styles.xml');
  }
  files['word/document.xml'] = strToU8(
    ieeeAccessDocumentXml(strFromU8(files['word/document.xml'])),
  );
  files['word/styles.xml'] = strToU8(ieeeAccessStylesXml(strFromU8(files['word/styles.xml'])));
  await writeFile(path, Buffer.from(zipSync(files, { level: 9, mtime: FIXED_MTIME })));
}

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

function sectionBreak(section, columns) {
  const geometry = sectionParts(section, ['pgSz', 'pgMar']);
  const grid = sectionParts(section, ['docGrid']);
  return `<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/>${geometry}<w:cols w:num="${columns}"${columns === 2 ? ' w:space="400"' : ''}/>${grid}</w:sectPr></w:pPr></w:p>`;
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

const REQUIRED_STYLES = {
  Table:
    '<w:style w:type="table" w:styleId="Table"><w:name w:val="Table"/><w:basedOn w:val="TableNormal"/><w:semiHidden/><w:unhideWhenUsed/><w:qFormat/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblStylePr w:type="firstRow"><w:tblPr><w:jc w:val="left"/><w:tblInd w:w="0" w:type="dxa"/></w:tblPr><w:trPr><w:jc w:val="left"/></w:trPr><w:tcPr><w:tcBorders><w:bottom w:val="single"/></w:tcBorders><w:vAlign w:val="bottom"/></w:tcPr></w:tblStylePr></w:style>',
  Compact:
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Compact"><w:name w:val="Compact"/><w:basedOn w:val="BodyText"/><w:qFormat/><w:pPr><w:spacing w:before="36" w:after="36"/></w:pPr></w:style>',
  FirstParagraph:
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="FirstParagraph"><w:name w:val="First Paragraph"/><w:basedOn w:val="BodyText"/><w:next w:val="BodyText"/><w:qFormat/></w:style>',
  ImageCaption:
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="ImageCaption"><w:name w:val="Image Caption"/><w:basedOn w:val="Caption"/></w:style>',
  Figure:
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Figure"><w:name w:val="Figure"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>',
  CaptionedFigure:
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="CaptionedFigure"><w:name w:val="Captioned Figure"/><w:basedOn w:val="Figure"/><w:pPr><w:keepNext/></w:pPr></w:style>',
};

function addRequiredStyles(styles) {
  const missing = Object.entries(REQUIRED_STYLES)
    .filter(([id]) => !new RegExp(`<w:style\\b(?=[^>]*w:styleId="${id}")`).test(styles))
    .map(([, style]) => style)
    .join('');
  return styles.replace('</w:styles>', `${missing}</w:styles>`);
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

  const front = sectionBreak(last[0], 1);
  let updated = document.slice(0, bodyHeading.index) + front + document.slice(bodyHeading.index);
  const shiftedLast = last.index + front.length;
  updated =
    updated.slice(0, shiftedLast) +
    twoColumns(last[0]) +
    updated.slice(shiftedLast + last[0].length);
  updated = updated.replace(
    /(<w:p\b(?=(?:(?!<\/w:p>)[\s\S])*?<w:pStyle\s+w:val="CaptionedFigure"\s*\/>)(?:(?!<\/w:p>)[\s\S])*?<\/w:p>\s*<w:p\b(?=(?:(?!<\/w:p>)[\s\S])*?<w:pStyle\s+w:val="ImageCaption"\s*\/>)(?:(?!<\/w:p>)[\s\S])*?<\/w:p>)/g,
    `${sectionBreak(last[0], 2)}$1${sectionBreak(last[0], 1)}`,
  );
  updated = updated.replace(
    /(<w:tbl\b[\s\S]*?<\/w:tbl>)/g,
    `${sectionBreak(last[0], 2)}$1${sectionBreak(last[0], 1)}`,
  );
  return updated;
}

export function ieeeAccessStylesXml(styles) {
  if (!/<w:style\b(?=[^>]*w:styleId="Normal")/.test(styles)) {
    fail('rendered document has no Normal paragraph style');
  }
  const normal = sizeStyle(addRequiredStyles(styles), 'Normal');
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

import { unzipSync, strFromU8 } from 'fflate';
import { tags, textOf } from './xml.js';

function extOf(path) {
  const i = path.lastIndexOf('.');
  return i === -1 ? '' : path.slice(i + 1).toLowerCase();
}

function readText(files, name) {
  const data = files[name];
  return data ? strFromU8(data) : '';
}

function detectOoxmlKind(path, files) {
  const ext = extOf(path || '');
  if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx') return ext;
  if (files['word/document.xml']) return 'docx';
  if (Object.keys(files).some((f) => f.startsWith('ppt/slides/'))) return 'pptx';
  if (files['xl/workbook.xml']) return 'xlsx';
  return null;
}

function headingTitle(paragraphInner) {
  const pStyle = tags(paragraphInner, 'w:pStyle')[0];
  if (!pStyle || !/^Heading\d+$/.test(pStyle.attrs['w:val'] ?? '')) return null;
  return true;
}

const RUN_CONTENT_RE =
  /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:tab(?:\s[^>]*)?\/>|<w:br(?:\s[^>]*)?\/>/g;

function paragraphText(paragraphInner) {
  let text = '';
  let m;
  RUN_CONTENT_RE.lastIndex = 0;
  while ((m = RUN_CONTENT_RE.exec(paragraphInner))) {
    if (m[0].startsWith('<w:tab')) text += ' ';
    else if (m[0].startsWith('<w:br')) text += '\n';
    else text += textOf(m[1] ?? '');
  }
  return text;
}

function parseDocx(files) {
  const xml = readText(files, 'word/document.xml');
  const bodyMatch = xml.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/);
  const body = bodyMatch ? bodyMatch[1] : xml;

  const tableBlocks = [];
  const bodyWithoutTables = body.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (block) => {
    tableBlocks.push(block);
    return '';
  });

  const tables = tableBlocks.map((block, i) => ({
    name: `Table ${i + 1}`,
    rows: tags(block, 'w:tr').map((tr) =>
      tags(tr.inner, 'w:tc').map((tc) =>
        tags(tc.inner, 'w:p')
          .map((p) => paragraphText(p.inner))
          .join(' ')
          .trim(),
      ),
    ),
  }));

  const paragraphs = tags(bodyWithoutTables, 'w:p').map((p) => ({
    isHeading: Boolean(headingTitle(p.inner)),
    text: paragraphText(p.inner),
  }));

  const sections = [];
  let current = null;
  for (const p of paragraphs) {
    if (p.isHeading) {
      current = { title: p.text, text: '' };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { title: '', text: '' };
      sections.push(current);
    }
    if (p.text) current.text = current.text ? `${current.text}\n${p.text}` : p.text;
  }
  const filteredSections = sections.filter((s) => !(s.title === '' && s.text === ''));

  const text = [...paragraphs.map((p) => p.text), ...tables.flatMap((t) => t.rows.flat())]
    .filter(Boolean)
    .join('\n');

  return { text, sections: filteredSections, tables };
}

function parseSlides(files) {
  const slideFiles = Object.keys(files)
    .map((name) => {
      const m = name.match(/^ppt\/slides\/slide(\d+)\.xml$/);
      return m ? { name, n: Number(m[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.n - b.n);

  const sections = slideFiles.map(({ name, n }) => {
    const xml = readText(files, name);
    const text = tags(xml, 'a:p')
      .map((p) =>
        tags(p.inner, 'a:t')
          .map((t) => textOf(t.inner))
          .join(''),
      )
      .join('\n');
    return { title: `Slide ${n}`, text };
  });

  const text = sections.map((s) => s.text).join('\n');
  return { text, sections, tables: [] };
}

function colIndex(ref) {
  const m = (ref || '').match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cellValue(cell, sharedStrings) {
  const type = cell.attrs.t;
  if (type === 's') {
    const idx = Number(textOf(tags(cell.inner, 'v')[0]?.inner ?? '0'));
    return sharedStrings[idx] ?? '';
  }
  if (type === 'inlineStr') {
    const isTag = tags(cell.inner, 'is')[0];
    if (!isTag) return '';
    return tags(isTag.inner, 't')
      .map((t) => textOf(t.inner))
      .join('');
  }
  const v = tags(cell.inner, 'v')[0];
  return v ? textOf(v.inner) : '';
}

function parseSheetRows(xml, sharedStrings) {
  const sheetData = tags(xml, 'sheetData')[0]?.inner ?? '';
  return tags(sheetData, 'row').map((row) => {
    const out = [];
    for (const cell of tags(row.inner, 'c')) {
      const idx = colIndex(cell.attrs.r);
      while (out.length < idx) out.push('');
      out.push(cellValue(cell, sharedStrings));
    }
    return out;
  });
}

function parseXlsx(files) {
  const workbookXml = readText(files, 'xl/workbook.xml');
  const sheetNames = tags(workbookXml, 'sheet').map((s) => s.attrs.name);

  const sharedStringsXml = readText(files, 'xl/sharedStrings.xml');
  const sharedStrings = sharedStringsXml
    ? tags(sharedStringsXml, 'si').map((si) =>
        tags(si.inner, 't')
          .map((t) => textOf(t.inner))
          .join(''),
      )
    : [];

  const tables = sheetNames.map((name, i) => {
    const sheetXml = readText(files, `xl/worksheets/sheet${i + 1}.xml`);
    return { name, rows: parseSheetRows(sheetXml, sharedStrings) };
  });

  const text = tables
    .flatMap((t) => t.rows.map((row) => row.join('\t')))
    .filter(Boolean)
    .join('\n');

  return { text, sections: [], tables };
}

export const ooxmlParser = {
  name: 'ooxml',
  kinds: ['docx', 'pptx', 'xlsx'],
  async available() {
    return true;
  },
  async parse(buffer, { path = '' } = {}) {
    let files;
    try {
      files = unzipSync(new Uint8Array(buffer));
    } catch {
      return {
        text: '',
        sections: [],
        tables: [],
        meta: {},
        warnings: ['not a valid OOXML package (zip could not be opened)'],
      };
    }

    const kind = detectOoxmlKind(path, files);
    try {
      if (kind === 'docx') return { ...parseDocx(files), meta: { kind }, warnings: [] };
      if (kind === 'pptx') return { ...parseSlides(files), meta: { kind }, warnings: [] };
      if (kind === 'xlsx') return { ...parseXlsx(files), meta: { kind }, warnings: [] };
    } catch (err) {
      return {
        text: '',
        sections: [],
        tables: [],
        meta: {},
        warnings: [`failed to parse OOXML package: ${err.message}`],
      };
    }

    return {
      text: '',
      sections: [],
      tables: [],
      meta: {},
      warnings: ['unrecognized OOXML kind: expected docx, pptx or xlsx'],
    };
  },
};

import { basename } from 'node:path';

function extOf(path) {
  const i = path.lastIndexOf('.');
  return i === -1 ? '' : path.slice(i + 1).toLowerCase();
}

function stemOf(path) {
  const base = basename(path);
  const i = base.lastIndexOf('.');
  return i <= 0 ? base || 'table' : base.slice(0, i);
}

function splitMarkdownSections(content) {
  const lines = content.split(/\r?\n/);
  const sections = [];
  let current = { title: '', text: '' };
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      sections.push(current);
      current = { title: heading[1].trim(), text: '' };
    } else {
      current.text += current.text ? `\n${line}` : line;
    }
  }
  sections.push(current);
  return sections
    .map((s) => ({ title: s.title, text: s.text.trim() }))
    .filter((s) => !(s.title === '' && s.text === ''));
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(content, name) {
  const rows = content
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map(parseCsvLine);
  return { name, rows };
}

export const textParser = {
  name: 'text',
  kinds: ['txt', 'md', 'csv', 'bib', 'tex'],
  async available() {
    return true;
  },
  async parse(buffer, { path = '' } = {}) {
    const content = buffer.toString('utf8');
    const ext = extOf(path);
    const warnings = [];

    if (!content) {
      return { text: '', sections: [], tables: [], meta: { kind: ext || 'txt' }, warnings };
    }

    if (ext === 'md') {
      return {
        text: content,
        sections: splitMarkdownSections(content),
        tables: [],
        meta: { kind: 'md' },
        warnings,
      };
    }

    if (ext === 'csv') {
      return {
        text: content,
        sections: [],
        tables: [parseCsv(content, stemOf(path))],
        meta: { kind: 'csv' },
        warnings,
      };
    }

    return {
      text: content,
      sections: [{ title: '', text: content.trim() }],
      tables: [],
      meta: { kind: ext || 'txt' },
      warnings,
    };
  },
};

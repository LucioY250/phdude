// Deterministic BibTeX and CSL-JSON rendering for the citation registry (PRD S37 / spec S3.3).
// Both entry points take the sources and the bibkeys already assigned by domain/bibkey.js, and
// never invent or reorder anything the sources do not already carry.

const BIBTEX_TYPE = {
  article: 'article',
  book: 'book',
  chapter: 'incollection',
  thesis: 'phdthesis',
  report: 'techreport',
  preprint: 'misc',
  web: 'misc',
  dataset: 'misc',
  other: 'misc',
};

const CSL_TYPE = {
  article: 'article-journal',
  book: 'book',
  chapter: 'chapter',
  thesis: 'thesis',
  report: 'report',
  preprint: 'article',
  web: 'webpage',
  dataset: 'dataset',
  other: 'document',
};

// The one BibTeX field a source's `venue` fills, chosen by entry type; everything else omits
// venue rather than guessing a field for it.
function venueField(type) {
  if (type === 'article') return 'journal';
  if (type === 'chapter') return 'booktitle';
  if (type === 'preprint') return 'howpublished';
  return null;
}

function doiOf(source) {
  return source.identifiers?.doi ?? source.doi;
}

function urlOf(source) {
  return source.identifiers?.url ?? source.url;
}

// Escapes BibTeX's special characters; braces are left untouched so a value that already
// carries its own `{}` protection (e.g. inside a title) is preserved rather than doubled.
function escapeBibtex(value) {
  return String(value).replace(/[&%_#]/g, (c) => `\\${c}`);
}

function bibtexEntry(source, key) {
  const type = BIBTEX_TYPE[source.type] ?? 'misc';
  const fields = [];

  if (source.authors?.length)
    fields.push(['author', source.authors.map(escapeBibtex).join(' and ')]);
  if (source.title) fields.push(['title', `{${escapeBibtex(source.title)}}`]);
  if (source.year !== undefined) fields.push(['year', String(source.year)]);

  const venue = venueField(source.type);
  if (venue && source.venue) fields.push([venue, escapeBibtex(source.venue)]);

  const doi = doiOf(source);
  if (doi) fields.push(['doi', escapeBibtex(doi)]);
  const url = urlOf(source);
  if (url) fields.push(['url', escapeBibtex(url)]);
  if (source.keywords?.length) fields.push(['keywords', escapeBibtex(source.keywords.join(', '))]);

  const body = fields.map(([name, value]) => `  ${name} = {${value}}`).join(',\n');
  return `@${type}{${key},\n${body}\n}`;
}

/**
 * Pure. Deterministic BibTeX bibliography text, entries sorted by bibkey. The abstract is
 * deliberately never rendered (the registry is derived, never canonical - spec S3.3).
 * @param {object[]} sources
 * @param {Map<string, string>} keys - source id -> bibkey, from domain/bibkey.js assignBibkeys
 * @returns {string}
 */
export function toBibtex(sources, keys) {
  const entries = [...sources]
    .map((s) => ({ source: s, key: keys.get(s.id) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return entries.map(({ source, key }) => bibtexEntry(source, key)).join('\n\n') + '\n';
}

/**
 * Pure. Splits one author string into its parts. "Family, Given" is recognized by its comma:
 * everything before it is the family name, taken as-is. Natural order ("Given Family") is
 * unchanged: every token but the last is the given name, the last token is the family name.
 * @param {string} name
 * @returns {{given?: string, family: string}}
 */
export function splitName(name) {
  const raw = String(name).trim();
  const commaIndex = raw.indexOf(',');
  if (commaIndex !== -1) {
    const family = raw.slice(0, commaIndex).trim();
    const given = raw.slice(commaIndex + 1).trim();
    return given ? { given, family } : { family };
  }
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return { family: tokens[0] ?? '' };
  return { given: tokens.slice(0, -1).join(' '), family: tokens[tokens.length - 1] };
}

function cslEntry(source, key) {
  const entry = {
    id: key,
    type: CSL_TYPE[source.type] ?? 'document',
    title: source.title,
    author: (source.authors ?? []).map(splitName),
  };
  if (source.year !== undefined) entry.issued = { 'date-parts': [[source.year]] };
  const doi = doiOf(source);
  if (doi) entry.DOI = doi;
  const url = urlOf(source);
  if (url) entry.URL = url;
  if (source.venue) entry['container-title'] = source.venue;
  if (source.keywords?.length) entry.keyword = source.keywords.join(', ');
  return entry;
}

/**
 * Pure. Deterministic CSL-JSON, sorted by bibkey.
 * @param {object[]} sources
 * @param {Map<string, string>} keys - source id -> bibkey, from domain/bibkey.js assignBibkeys
 * @returns {object[]}
 */
export function toCslJson(sources, keys) {
  const entries = [...sources]
    .map((s) => ({ source: s, key: keys.get(s.id) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return entries.map(({ source, key }) => cslEntry(source, key));
}

// The reading half: a `references.bib` this module wrote, read back. Only the fields the
// registry puts there are recovered, because those are the only ones a renderer needs; a file a
// researcher hand-edited is parsed as far as it parses and the rest is skipped, never thrown on.
const IGNORED_ENTRY_TYPES = new Set(['comment', 'string', 'preamble']);

const ENTRY_HEADER = /@([A-Za-z]+)[\s]*\{/y;
const FIELD_NAME = /^[\s,]*([A-Za-z][A-Za-z0-9_-]*)[\s]*=[\s]*/;

// The index of the `}` closing the `{` at `open`, or -1 when the entry runs off the end.
function matchingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function unescapeBibtex(value) {
  return value.replace(/\\([&%_#$])/g, '$1');
}

// `title = {{A Survey}}` protects its capitalization with a second layer of braces; the value is
// the text, not the protection. Braces that wrap only part of the value (`A {B} C`) stay.
function stripOuterBraces(value) {
  let text = value.trim();
  while (text.startsWith('{') && matchingBrace(text, 0) === text.length - 1) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function parseFields(body) {
  const comma = body.indexOf(',');
  const key = (comma === -1 ? body : body.slice(0, comma)).trim();
  const fields = {};
  let i = comma === -1 ? body.length : comma + 1;

  while (i < body.length) {
    const name = FIELD_NAME.exec(body.slice(i));
    if (!name) break;
    i += name[0].length;

    let value;
    if (body[i] === '{') {
      const end = matchingBrace(body, i);
      if (end === -1) break;
      value = body.slice(i + 1, end);
      i = end + 1;
    } else if (body[i] === '"') {
      const end = body.indexOf('"', i + 1);
      if (end === -1) break;
      value = body.slice(i + 1, end);
      i = end + 1;
    } else {
      let end = i;
      while (end < body.length && body[end] !== ',') end++;
      value = body.slice(i, end);
      i = end;
    }
    fields[name[1].toLowerCase()] = unescapeBibtex(stripOuterBraces(value));
  }

  return { key, fields };
}

function yearOf(value) {
  return value !== undefined && /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
}

/**
 * Pure. Reads a BibTeX bibliography into the fields a renderer needs. Anything it cannot parse -
 * an unterminated entry, `@string`, `@comment`, junk between entries - is skipped rather than
 * thrown on, so a hand-edited `references.bib` still renders the entries that are well formed.
 * Entries come back in file order.
 * @param {string} text
 * @returns {{key: string, type: string, authors: string[], title: string|null, year: number|null,
 *   venue: string|null, doi: string|null, url: string|null}[]}
 */
export function parseBibtex(text) {
  const source = String(text ?? '');
  const entries = [];
  let at = source.indexOf('@');

  while (at !== -1) {
    ENTRY_HEADER.lastIndex = at;
    const header = ENTRY_HEADER.exec(source);
    const close = header ? matchingBrace(source, ENTRY_HEADER.lastIndex - 1) : -1;
    if (close === -1) {
      at = source.indexOf('@', at + 1);
      continue;
    }

    const type = header[1].toLowerCase();
    if (!IGNORED_ENTRY_TYPES.has(type)) {
      const { key, fields } = parseFields(source.slice(ENTRY_HEADER.lastIndex, close));
      if (key) {
        entries.push({
          key,
          type,
          authors: fields.author ? fields.author.split(/\s+and\s+/).filter(Boolean) : [],
          title: fields.title ?? null,
          year: yearOf(fields.year),
          venue: fields.journal ?? fields.booktitle ?? fields.howpublished ?? null,
          doi: fields.doi ?? null,
          url: fields.url ?? null,
        });
      }
    }

    at = source.indexOf('@', close + 1);
  }

  return entries;
}

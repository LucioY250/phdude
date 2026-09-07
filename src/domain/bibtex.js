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

// "Family, Given" is recognized by its comma: everything before it is the family name, taken
// as-is. Natural order ("Given Family") is unchanged: every token but the last is the given
// name, the last token is the family name.
function splitName(name) {
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

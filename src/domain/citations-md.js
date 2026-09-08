// The reference list PhDude writes when Pandoc is not there to write one (spec §3.1). Pandoc's
// citation syntax in, plain author-year Markdown out: `[@key]` becomes `(Surname, Year)` and the
// entries actually cited become a `## References` section. It is deliberately one fixed style -
// a CSL engine is what `--csl` and Pandoc are for, and this module never pretends to be one.

import { splitName } from './bibtex.js';

// The same reading as gate-citations: a bracketed group holds the citations, and a bare `@key`
// outside brackets is not one, so an email address in the prose is left alone.
const GROUP_RE = /\[[^\]]*\]/g;
const ITEM_RE = /^(.*?)(-?)@([A-Za-z0-9][A-Za-z0-9_:.-]*)(.*)$/;

const REFERENCES_HEADING = '## References';

function familyOf(author) {
  return splitName(author).family;
}

// Author-year in text: one name, two joined with "and", three or more shortened to et al.
function authorText(entry) {
  const families = entry.authors.map(familyOf).filter(Boolean);
  if (families.length === 0) return 'Anon.';
  if (families.length === 1) return families[0];
  if (families.length === 2) return `${families[0]} and ${families[1]}`;
  return `${families[0]} et al.`;
}

function yearText(entry) {
  return entry.year === null || entry.year === undefined ? 'n.d.' : String(entry.year);
}

function initials(given) {
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `${token[0].toUpperCase()}.`)
    .join(' ');
}

function referenceName(author) {
  const { given, family } = splitName(author);
  return given ? `${family}, ${initials(given)}` : family;
}

function referenceNames(entry) {
  const names = entry.authors.map(referenceName).filter(Boolean);
  if (names.length === 0) return 'Anon.';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
}

/**
 * Pure. One bibliography entry as a plain author-year paragraph.
 * @param {object} entry - as returned by parseBibtex
 * @returns {string}
 */
export function referenceEntry(entry) {
  const parts = [`${referenceNames(entry)} (${yearText(entry)}).`];
  if (entry.title) parts.push(`${String(entry.title).replace(/\.\s*$/, '')}.`);
  if (entry.venue) parts.push(`${String(entry.venue).replace(/\.\s*$/, '')}.`);
  if (entry.doi) parts.push(`https://doi.org/${entry.doi}`);
  else if (entry.url) parts.push(entry.url);
  return parts.join(' ');
}

function byAuthorYear(a, b) {
  const familyA = (a.authors[0] ? familyOf(a.authors[0]) : '').toLowerCase();
  const familyB = (b.authors[0] ? familyOf(b.authors[0]) : '').toLowerCase();
  return (
    familyA.localeCompare(familyB) ||
    (a.year ?? 0) - (b.year ?? 0) ||
    String(a.title ?? '').localeCompare(String(b.title ?? '')) ||
    a.key.localeCompare(b.key)
  );
}

// A key may end in punctuation that belongs to the sentence rather than to the key
// (`[@smith2020.]`); the punctuation is handed back to the text after it, never dropped.
function splitKey(raw, rest) {
  const trailing = /[.:_-]+$/.exec(raw);
  return trailing
    ? { key: raw.slice(0, -trailing[0].length), rest: `${trailing[0]}${rest}` }
    : { key: raw, rest };
}

function parseItem(text) {
  const match = ITEM_RE.exec(text);
  if (!match) return null;
  const { key, rest } = splitKey(match[3], match[4]);
  if (!key) return null;
  return {
    prefix: match[1].trim(),
    suppressAuthor: match[2] === '-',
    key,
    locator: rest.replace(/^\s*,\s*/, '').trim(),
  };
}

function renderItem(item, entry) {
  if (!entry)
    return `${item.prefix ? `${item.prefix} ` : ''}${item.suppressAuthor ? '-' : ''}@${item.key}${item.locator ? `, ${item.locator}` : ''}`;
  const parts = [];
  if (item.prefix) parts.push(item.prefix);
  parts.push(item.suppressAuthor ? yearText(entry) : `${authorText(entry)}, ${yearText(entry)}`);
  const rendered = parts.join(' ');
  return item.locator ? `${rendered}, ${item.locator}` : rendered;
}

/**
 * Pure. Resolves every `[@key]` in the text against the bibliography and appends the reference
 * list for the entries actually cited, in author-year order. A key the bibliography does not
 * carry is left in the prose as written and reported as a warning - dropping a citation because
 * the registry is behind would hide exactly the thing worth seeing.
 * @param {string} text
 * @param {object[]} entries - as returned by parseBibtex
 * @returns {{markdown: string, warnings: string[], cited: string[]}}
 */
export function resolveCitations(text, entries) {
  const source = String(text ?? '');
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const cited = new Map();
  const missing = new Set();

  const resolved = source.replace(GROUP_RE, (group) => {
    const items = group
      .slice(1, -1)
      .split(';')
      .map((part) => parseItem(part));
    if (items.every((item) => item === null)) return group;

    const rendered = items.map((item, index) => {
      if (item === null) return group.slice(1, -1).split(';')[index].trim();
      const entry = byKey.get(item.key);
      if (entry) cited.set(entry.key, entry);
      else missing.add(item.key);
      return renderItem(item, entry);
    });

    return `(${rendered.join('; ')})`;
  });

  const references = [...cited.values()].sort(byAuthorYear);
  const warnings = [...missing]
    .sort()
    .map((key) => `[@${key}] does not resolve to an entry in the bibliography`);

  if (references.length === 0) return { markdown: resolved, warnings, cited: [] };

  const list = references.map(referenceEntry).join('\n\n');
  return {
    markdown: `${resolved.replace(/\s+$/, '')}\n\n${REFERENCES_HEADING}\n\n${list}\n`,
    warnings,
    cited: references.map((entry) => entry.key),
  };
}

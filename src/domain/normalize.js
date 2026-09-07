export function normalizeText(s) {
  return String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}
export function normalizeKey(s) {
  return normalizeText(s)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// JSON.stringify with keys sorted at every depth. The replacer-array form sorts only the top
// level and silently drops every nested key, which would erase nested values from any id
// derived from an object (see domain/entities.js newDecision). Member and array semantics
// otherwise match JSON.stringify: an undefined member is dropped, an undefined array slot is
// null.
export function stableStringify(value) {
  if (value === undefined || typeof value === 'function') return undefined;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v) ?? 'null').join(',')}]`;
  }
  const members = [];
  for (const key of Object.keys(value).sort()) {
    const encoded = stableStringify(value[key]);
    if (encoded !== undefined) members.push(`${JSON.stringify(key)}:${encoded}`);
  }
  return `{${members.join(',')}}`;
}

// A DOI as the registry defines it: no resolver prefix, lowercased so two providers reporting
// the same work compare equal. Anything that is not a DOI is null rather than a guess.
export function normalizeDoi(value) {
  if (typeof value !== 'string') return null;
  const doi = value
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

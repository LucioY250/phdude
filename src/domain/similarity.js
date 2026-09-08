// Title comparison for the citation auditor (spec §3.1): the normalized token Jaccard the DOI
// check thresholds at 0.8. This is deliberately not the identity normalization in
// `domain/normalize.js` — two records of the same work are compared here, not merged, so
// diacritics are folded and markup dropped rather than preserved. A publisher's JATS `<i>` and
// a researcher's un-accented retyping of a Spanish title must not read as a different paper.

const WORD_RE = /[\p{L}\p{N}]+/gu;

/** The similarity a Crossref title must reach to count as the same work (spec §3.1). */
export const TITLE_SIMILARITY_THRESHOLD = 0.8;

/**
 * @param {string} text
 * @returns {Set<string>} the distinct words of `text`, folded
 */
export function titleTokens(text) {
  const folded = String(text ?? '')
    .replace(/<[^>]*>/g, ' ')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
  return new Set(folded.match(WORD_RE) ?? []);
}

/**
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number} shared over union, 0 when either side is empty
 */
export function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} between 0 and 1
 */
export function titleSimilarity(a, b) {
  return jaccard(titleTokens(a), titleTokens(b));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A custom "whole word" boundary: not adjacent to an alphanumeric/underscore character on
// either side. Plain \b breaks for keywords that start or end with a non-word character
// (e.g. "c++"), since \b only fires on a word/non-word transition.
function keywordPattern(keyword) {
  const escaped = escapeRegExp(keyword.trim()).replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'gi');
}

function byScoreThenName(a, b) {
  return b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/**
 * @param {{name: string, kind: string, detect: {keywords: string[]}}[]} packs
 * @param {string[]} texts
 * @returns {{name: string, kind: string, score: number, hits: {keyword: string, count: number}[]}[]}
 */
export function scorePackDetection(packs, texts) {
  const combined = texts.join('\n');
  const results = [];
  for (const pack of packs) {
    const keywords = pack.detect?.keywords ?? [];
    if (keywords.length === 0) continue;
    const hits = [];
    for (const keyword of keywords) {
      const matches = combined.match(keywordPattern(keyword));
      if (matches?.length) hits.push({ keyword, count: matches.length });
    }
    const score = Math.round((hits.length / keywords.length) * 1000) / 1000;
    if (score > 0) results.push({ name: pack.name, kind: pack.kind, score, hits });
  }
  return results.sort(byScoreThenName);
}

/**
 * @param {{name: string, score: number}[]} scores
 * @param {{threshold?: number}} [opts]
 * @returns {string[]}
 */
export function recommendPacks(scores, { threshold = 0.25 } = {}) {
  return scores
    .filter((s) => s.score >= threshold)
    .map((s) => s.name)
    .sort();
}

import { normalizeDoi, normalizeText } from './normalize.js';

// Two providers describing the same work have to collapse into one candidate, or the
// researcher reviews the same paper once per provider. Spec §3.3 makes that an either/or: the
// same DOI, *or* the same normalized title and year. Both keys are registered for every
// candidate, so a work one provider has a DOI for and another does not still merges - which is
// the common case for preprints, and for a preprint and its published version. A malformed DOI
// is treated as no DOI rather than as an identity, so a provider's bad data cannot merge two
// unrelated works on its own.
function identityKeys(candidate) {
  const keys = [];
  const doi = normalizeDoi(candidate.doi);
  if (doi) keys.push(`doi:${doi}`);
  const title = normalizeText(candidate.title ?? '');
  if (title) keys.push(`title:${title}|${candidate.year ?? ''}`);
  return keys;
}

/**
 * Collapses cross-provider duplicates, first occurrence wins. The winner keeps its own
 * `provider` and `external_id`; every provider that returned the work is listed in
 * `providers`, and the losers' ids are kept under `ext.ids[provider]` so a later lookup can
 * still reach the work through the provider that did not own it. Fields are never merged
 * across providers: one record's description of a work stays one provider's description.
 * @param {import('../ports/search-provider.js').Candidate[]} candidates - in rank order
 * @returns {object[]} deduplicated candidates in the same order, each with `providers[]`
 */
export function dedupe(candidates) {
  const byIdentity = new Map();
  const merged = [];

  for (const candidate of candidates) {
    const keys = identityKeys(candidate);
    const existing = keys.map((key) => byIdentity.get(key)).find(Boolean);
    if (!existing) {
      const copy = { ...candidate, providers: [candidate.provider] };
      for (const key of keys) byIdentity.set(key, copy);
      merged.push(copy);
      continue;
    }
    // The loser's keys now point at the winner too, so a third provider matching either one
    // joins the same group instead of starting a second.
    for (const key of keys) if (!byIdentity.has(key)) byIdentity.set(key, existing);
    if (existing.providers.includes(candidate.provider)) continue;
    existing.providers.push(candidate.provider);
    existing.ext = {
      ...existing.ext,
      ids: { ...existing.ext?.ids, [candidate.provider]: candidate.external_id },
    };
  }

  return merged;
}

/**
 * Applies the workspace's research preferences to what the providers returned, after their own
 * server-side filtering. A candidate is dropped only when it is demonstrably out of scope; an
 * unknown year or an unreported language is never grounds for dropping one.
 *
 * The language check is a no-op in practice: no v0.3 provider reports a language, so no
 * candidate carries `lang` and none is ever dropped for it. It is written against the field
 * anyway so a provider that starts reporting one is honoured without a code change.
 *
 * A preprint is flagged, never dropped: `preprints.require_approval` means the researcher has
 * to see it and say yes, not that PhDude hides it (spec §3.3).
 * @param {object[]} candidates
 * @param {{from?: number|null, languages?: string[], preprintsRequireApproval?: boolean}} filters
 * @returns {object[]} new candidate objects carrying `needs_approval`
 */
export function applyFilters(candidates, filters = {}) {
  const { from = null, languages = [], preprintsRequireApproval = false } = filters;
  const kept = [];

  for (const candidate of candidates) {
    if (from !== null && candidate.year !== null && candidate.year !== undefined) {
      if (candidate.year < from) continue;
    }
    if (languages.length > 0 && typeof candidate.lang === 'string') {
      if (!languages.includes(candidate.lang)) continue;
    }
    kept.push({
      ...candidate,
      needs_approval: preprintsRequireApproval === true && candidate.type === 'preprint',
    });
  }

  return kept;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * A deterministic relevance score, explained part by part so a researcher can see why one
 * candidate outranks another (spec §3.3). No model, no network, no hidden state: the same
 * inputs always produce the same number.
 *
 * - `rank`: `1/(1+position)`, so the providers' own relevance ordering still counts most.
 * - `citations`: `log10(1+cited_by)/4`, log-scaled so a 10,000-citation classic does not bury
 *   everything else, and 0 when the provider does not report citations.
 * - `recency`: linear decay over ten years from `currentYear`, floored at 0, and 0 when the
 *   year is unknown.
 *
 * Each part is rounded to three decimals and the score is their sum, so the parts a reader
 * sees always add up to the score they are given.
 * @param {object} candidate
 * @param {number} rank - the candidate's zero-based position after dedup
 * @param {{currentYear?: number}} filters - `currentYear` is injected by the caller (the
 *   domain never reads a clock); without it the recency part is 0
 * @returns {{score: number, score_parts: {rank: number, citations: number, recency: number}}}
 */
export function score(candidate, rank, filters = {}) {
  const currentYear = Number.isInteger(filters.currentYear) ? filters.currentYear : null;
  const citedBy = Number.isFinite(candidate.cited_by) ? candidate.cited_by : null;
  const year = Number.isInteger(candidate.year) ? candidate.year : null;

  const parts = {
    rank: round3(1 / (1 + rank)),
    citations: citedBy === null ? 0 : round3(Math.log10(1 + citedBy) / 4),
    recency:
      year === null || currentYear === null
        ? 0
        : round3(Math.max(0, 1 - (currentYear - year) / 10)),
  };

  return { score: round3(parts.rank + parts.citations + parts.recency), score_parts: parts };
}

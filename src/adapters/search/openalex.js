import { PhdudeError } from '../../domain/errors.js';
import { normalizeDoi } from '../../domain/normalize.js';
import { fetchWithPolicy, readJson, userAgent } from './http.js';

const NAME = 'openalex';
const ENDPOINT = 'https://api.openalex.org/works';
const ID_PREFIX = 'https://openalex.org/';

// OpenAlex has far more work types than a candidate needs; anything the researcher does not
// cite differently collapses into "other".
const TYPES = {
  article: 'article',
  preprint: 'preprint',
  book: 'book',
  'book-chapter': 'chapter',
};

/**
 * @param {{fetch: Function, version: string, mailto?: string|null}} deps
 * @returns {import('../../ports/search-provider.js').SearchProvider}
 */
export function openalex({ fetch, version, mailto = null }) {
  return {
    name: NAME,
    async search(query, { from = null, limit = 20, signal } = {}) {
      const url = new URL(ENDPOINT);
      url.searchParams.set('search', String(query));
      url.searchParams.set('per-page', String(limit));
      if (from) url.searchParams.set('filter', `from_publication_date:${from}-01-01`);
      // The polite pool: OpenAlex gives a named caller a faster, more reliable lane.
      if (mailto) url.searchParams.set('mailto', mailto);

      const response = await fetchWithPolicy(fetch, url.href, {
        provider: NAME,
        headers: { 'user-agent': userAgent(version) },
        signal,
      });

      const body = await readJson(response, NAME);
      if (!Array.isArray(body?.results)) {
        throw new PhdudeError(
          'VALIDATION',
          `${NAME}: response did not carry a results array`,
          'the provider may have changed its API',
        );
      }

      return body.results.map(toCandidate).filter(Boolean).slice(0, limit);
    },
  };
}

function toCandidate(work) {
  const title = text(work?.display_name ?? work?.title);
  const doi = normalizeDoi(work?.doi);
  const externalId = text(work?.id)?.replace(ID_PREFIX, '') ?? doi;
  // A work we cannot name or address is not a candidate a researcher could review.
  if (!title || !externalId) return null;

  return {
    provider: NAME,
    external_id: externalId,
    title,
    authors: authorsOf(work),
    year: Number.isInteger(work?.publication_year) ? work.publication_year : null,
    venue: text(work?.primary_location?.source?.display_name),
    doi,
    url: text(work?.primary_location?.landing_page_url) ?? (doi ? `https://doi.org/${doi}` : null),
    abstract: abstractOf(work?.abstract_inverted_index),
    type: TYPES[work?.type] ?? 'other',
    open_access: typeof work?.open_access?.is_oa === 'boolean' ? work.open_access.is_oa : null,
    cited_by: Number.isInteger(work?.cited_by_count) ? work.cited_by_count : null,
  };
}

function authorsOf(work) {
  if (!Array.isArray(work?.authorships)) return [];
  return work.authorships
    .map((a) => text(a?.author?.display_name ?? a?.raw_author_name))
    .filter(Boolean);
}

// OpenAlex ships abstracts as a word -> positions index for copyright reasons; putting the
// words back in order is the only way to show the researcher what the paper claims.
function abstractOf(inverted) {
  if (!inverted || typeof inverted !== 'object' || Array.isArray(inverted)) return null;
  const words = [];
  for (const [word, positions] of Object.entries(inverted)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0) words[position] = word;
    }
  }
  const abstract = words
    .filter((w) => typeof w === 'string')
    .join(' ')
    .trim();
  return abstract || null;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

import { PhdudeError } from '../../domain/errors.js';
import { normalizeDoi } from '../../domain/normalize.js';
import { fetchWithPolicy, readJson, userAgent } from './http.js';

const NAME = 'crossref';
const ENDPOINT = 'https://api.crossref.org/works';

const TYPES = {
  'journal-article': 'article',
  'proceedings-article': 'article',
  'posted-content': 'preprint',
  book: 'book',
  'book-chapter': 'chapter',
};

/**
 * @param {{fetch: Function, version: string, mailto?: string|null}} deps
 * @returns {import('../../ports/search-provider.js').SearchProvider}
 */
export function crossref({ fetch, version, mailto = null }) {
  return {
    name: NAME,
    async search(query, { from = null, limit = 20, signal } = {}) {
      const url = new URL(ENDPOINT);
      url.searchParams.set('query', String(query));
      url.searchParams.set('rows', String(limit));
      if (from) url.searchParams.set('filter', `from-pub-date:${from}`);
      // The polite pool, same bargain as OpenAlex: a named caller gets the reliable lane.
      if (mailto) url.searchParams.set('mailto', mailto);

      const response = await fetchWithPolicy(fetch, url.href, {
        provider: NAME,
        headers: { 'user-agent': userAgent(version) },
        signal,
      });

      const body = await readJson(response, NAME);
      if (!Array.isArray(body?.message?.items)) {
        throw new PhdudeError(
          'VALIDATION',
          `${NAME}: response did not carry a message.items array`,
          'the provider may have changed its API',
        );
      }

      return body.message.items.map(toCandidate).filter(Boolean).slice(0, limit);
    },
  };
}

function toCandidate(item) {
  const title = first(item?.title);
  const doi = normalizeDoi(item?.DOI);
  if (!title || !doi) return null;

  return {
    provider: NAME,
    external_id: doi,
    title,
    authors: authorsOf(item),
    year: yearOf(item),
    venue: first(item?.['container-title']),
    doi,
    url: text(item?.URL) ?? `https://doi.org/${doi}`,
    abstract: stripMarkup(item?.abstract),
    type: TYPES[item?.type] ?? 'other',
    // Crossref says nothing about access, and guessing would be a claim about the source.
    open_access: null,
    cited_by: Number.isInteger(item?.['is-referenced-by-count'])
      ? item['is-referenced-by-count']
      : null,
  };
}

function authorsOf(item) {
  if (!Array.isArray(item?.author)) return [];
  return item.author
    .map((a) => text(a?.name) ?? text([text(a?.given), text(a?.family)].filter(Boolean).join(' ')))
    .filter(Boolean);
}

function yearOf(item) {
  const year = item?.issued?.['date-parts']?.[0]?.[0];
  return Number.isInteger(year) ? year : null;
}

// Crossref abstracts arrive as JATS XML. Tags become spaces rather than nothing, so a
// <jats:title> does not run into the paragraph that follows it.
function stripMarkup(value) {
  if (typeof value !== 'string') return null;
  const stripped = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || null;
}

function first(value) {
  return Array.isArray(value) ? text(value[0]) : text(value);
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

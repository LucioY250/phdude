import { PhdudeError } from '../../domain/errors.js';
import { normalizeDoi } from '../../domain/normalize.js';
import { tags, textOf } from '../documents/xml.js';
import { fetchWithPolicy, userAgent } from './http.js';

const NAME = 'arxiv';
const ENDPOINT = 'http://export.arxiv.org/api/query';
const ABS_PREFIX = /^https?:\/\/arxiv\.org\/abs\//;

/**
 * @param {{fetch: Function, version: string}} deps
 * @returns {import('../../ports/search-provider.js').SearchProvider}
 */
export function arxiv({ fetch, version }) {
  return {
    name: NAME,
    // arXiv has no server-side date filter, so `from` is applied after the fact on each
    // entry's published year. The contract suite checks results rather than the request URL
    // for a provider that sets this.
    filtersDateClientSide: true,
    async search(query, { from = null, limit = 20, signal } = {}) {
      const url = new URL(ENDPOINT);
      url.searchParams.set('search_query', `all:${query}`);
      url.searchParams.set('start', '0');
      url.searchParams.set('max_results', String(limit));
      url.searchParams.set('sortBy', 'relevance');

      const response = await fetchWithPolicy(fetch, url.href, {
        provider: NAME,
        headers: { 'user-agent': userAgent(version) },
        signal,
      });

      const body = await response.text();
      if (!/<feed[\s>]/.test(body)) {
        throw new PhdudeError(
          'VALIDATION',
          `${NAME}: response was not a valid Atom feed`,
          'the provider may have changed its API',
        );
      }

      const candidates = tags(body, 'entry')
        .map((entry) => toCandidate(entry.inner))
        .filter(Boolean)
        .filter((c) => from == null || c.year == null || c.year >= from);

      return candidates.slice(0, limit);
    },
  };
}

function toCandidate(inner) {
  const title = text(tags(inner, 'title')[0]?.inner);
  const externalId = idOf(inner);
  // A work we cannot name or address is not a candidate a researcher could review.
  if (!title || !externalId) return null;

  return {
    provider: NAME,
    external_id: externalId,
    title,
    authors: authorsOf(inner),
    year: yearOf(inner),
    venue: null,
    doi: normalizeDoi(text(tags(inner, 'arxiv:doi')[0]?.inner)),
    url: urlOf(inner),
    abstract: text(tags(inner, 'summary')[0]?.inner),
    type: 'preprint',
    open_access: true,
    cited_by: null,
  };
}

function authorsOf(inner) {
  return tags(inner, 'author')
    .map((a) => text(tags(a.inner, 'name')[0]?.inner))
    .filter(Boolean);
}

function yearOf(inner) {
  const published = text(tags(inner, 'published')[0]?.inner);
  const match = published?.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

// The arXiv id without its version suffix, so the same paper at two revisions is still one
// external_id.
function idOf(inner) {
  const raw = text(tags(inner, 'id')[0]?.inner);
  if (!raw) return null;
  return raw.replace(ABS_PREFIX, '').replace(/v\d+$/, '') || null;
}

function urlOf(inner) {
  const pdf = tags(inner, 'link').find((l) => l.attrs.title === 'pdf');
  return text(pdf?.attrs.href) ?? text(tags(inner, 'id')[0]?.inner);
}

function text(value) {
  if (typeof value !== 'string') return null;
  const collapsed = textOf(value).replace(/\s+/g, ' ').trim();
  return collapsed || null;
}

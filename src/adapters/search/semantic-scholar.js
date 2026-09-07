import { PhdudeError } from '../../domain/errors.js';
import { normalizeDoi } from '../../domain/normalize.js';
import { fetchWithPolicy, readJson, userAgent } from './http.js';

const NAME = 'semantic-scholar';
const ENDPOINT = 'https://api.semanticscholar.org/graph/v1/paper/search';
const FIELDS =
  'title,authors,year,venue,externalIds,abstract,url,citationCount,isOpenAccess,publicationTypes';

// Semantic Scholar reports many publication types; anything a researcher would not cite
// differently collapses into "other".
const TYPES = { JournalArticle: 'article', Book: 'book', BookSection: 'chapter' };

/**
 * @param {{fetch: Function, env: object, version: string}} deps
 * @returns {import('../../ports/search-provider.js').SearchProvider}
 */
export function semanticScholar({ fetch, env = {}, version }) {
  return {
    name: NAME,
    async search(query, { from = null, limit = 20, signal } = {}) {
      const url = new URL(ENDPOINT);
      url.searchParams.set('query', String(query));
      url.searchParams.set('limit', String(limit));
      if (from) url.searchParams.set('year', `${from}-`);
      url.searchParams.set('fields', FIELDS);

      const headers = { 'user-agent': userAgent(version) };
      // The key is never logged: it only ever goes on this one outgoing header.
      if (env?.PHDUDE_S2_API_KEY) headers['x-api-key'] = env.PHDUDE_S2_API_KEY;

      const response = await fetchWithPolicy(fetch, url.href, {
        provider: NAME,
        headers,
        signal,
      });

      const body = await readJson(response, NAME);
      if (!Array.isArray(body?.data)) {
        throw new PhdudeError(
          'VALIDATION',
          `${NAME}: response did not carry a data array`,
          'the provider may have changed its API',
        );
      }

      return body.data.map(toCandidate).filter(Boolean).slice(0, limit);
    },
  };
}

function toCandidate(paper) {
  const title = text(paper?.title);
  const externalId = text(paper?.paperId);
  // A work we cannot name or address is not a candidate a researcher could review.
  if (!title || !externalId) return null;

  return {
    provider: NAME,
    external_id: externalId,
    title,
    authors: authorsOf(paper),
    year: Number.isInteger(paper?.year) ? paper.year : null,
    venue: text(paper?.venue),
    doi: normalizeDoi(paper?.externalIds?.DOI),
    url: text(paper?.url),
    abstract: text(paper?.abstract),
    type: typeOf(paper?.publicationTypes),
    open_access: typeof paper?.isOpenAccess === 'boolean' ? paper.isOpenAccess : null,
    cited_by: Number.isInteger(paper?.citationCount) ? paper.citationCount : null,
  };
}

function authorsOf(paper) {
  if (!Array.isArray(paper?.authors)) return [];
  return paper.authors.map((a) => text(a?.name)).filter(Boolean);
}

function typeOf(publicationTypes) {
  if (!Array.isArray(publicationTypes)) return 'other';
  for (const t of publicationTypes) {
    if (TYPES[t]) return TYPES[t];
  }
  return 'other';
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

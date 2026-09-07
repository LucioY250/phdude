import { PhdudeError } from '../../domain/errors.js';
import { normalizeDoi } from '../../domain/normalize.js';
import { fetchWithPolicy, readJson, userAgent } from './http.js';

const NAME = 'pubmed';
const ESEARCH_ENDPOINT = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
const ESUMMARY_ENDPOINT = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';

/**
 * @param {{fetch: Function, env: object, version: string}} deps
 * @returns {import('../../ports/search-provider.js').SearchProvider}
 */
export function pubmed({ fetch, env = {}, version }) {
  return {
    name: NAME,
    async search(query, { from = null, limit = 20, signal } = {}) {
      const headers = { 'user-agent': userAgent(version) };
      const apiKey = typeof env?.PHDUDE_NCBI_API_KEY === 'string' ? env.PHDUDE_NCBI_API_KEY : null;

      const esearchUrl = new URL(ESEARCH_ENDPOINT);
      esearchUrl.searchParams.set('db', 'pubmed');
      esearchUrl.searchParams.set('term', String(query));
      esearchUrl.searchParams.set('retmax', String(limit));
      esearchUrl.searchParams.set('retmode', 'json');
      if (from) {
        esearchUrl.searchParams.set('mindate', String(from));
        esearchUrl.searchParams.set('maxdate', '3000');
        esearchUrl.searchParams.set('datetype', 'pdat');
      }
      if (apiKey) esearchUrl.searchParams.set('api_key', apiKey);

      const esearchResponse = await fetchWithPolicy(fetch, esearchUrl.href, {
        provider: NAME,
        headers,
        signal,
      });
      const esearchBody = await readJson(esearchResponse, NAME);
      const ids = esearchBody?.esearchresult?.idlist;
      if (!Array.isArray(ids)) {
        throw new PhdudeError(
          'VALIDATION',
          `${NAME}: response did not carry an idlist`,
          'the provider may have changed its API',
        );
      }
      // Nothing to summarize: skip the second call rather than asking esummary for zero ids.
      if (ids.length === 0) return [];

      const esummaryUrl = new URL(ESUMMARY_ENDPOINT);
      esummaryUrl.searchParams.set('db', 'pubmed');
      esummaryUrl.searchParams.set('id', ids.join(','));
      esummaryUrl.searchParams.set('retmode', 'json');
      if (apiKey) esummaryUrl.searchParams.set('api_key', apiKey);

      const esummaryResponse = await fetchWithPolicy(fetch, esummaryUrl.href, {
        provider: NAME,
        headers,
        signal,
      });
      const esummaryBody = await readJson(esummaryResponse, NAME);
      const result = esummaryBody?.result;
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new PhdudeError(
          'VALIDATION',
          `${NAME}: response did not carry a result object`,
          'the provider may have changed its API',
        );
      }

      // Walk `ids` (the esearch relevance order) rather than Object.keys(result): PubMed uids
      // are numeric strings, and JS reorders integer-like object keys ascending.
      return ids
        .map((id) => toCandidate(result[id]))
        .filter(Boolean)
        .slice(0, limit);
    },
  };
}

function toCandidate(doc) {
  const title = text(doc?.title);
  const externalId = text(doc?.uid);
  // A work we cannot name or address is not a candidate a researcher could review.
  if (!title || !externalId) return null;

  return {
    provider: NAME,
    external_id: externalId,
    title,
    authors: authorsOf(doc),
    year: yearOf(doc?.pubdate),
    venue: text(doc?.fulljournalname),
    doi: doiOf(doc),
    url: `https://pubmed.ncbi.nlm.nih.gov/${externalId}/`,
    abstract: null,
    type: 'article',
    open_access: null,
    cited_by: null,
  };
}

function authorsOf(doc) {
  if (!Array.isArray(doc?.authors)) return [];
  return doc.authors.map((a) => text(a?.name)).filter(Boolean);
}

function yearOf(pubdate) {
  const match = text(pubdate)?.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function doiOf(doc) {
  if (!Array.isArray(doc?.articleids)) return null;
  const entry = doc.articleids.find((a) => a?.idtype === 'doi');
  return normalizeDoi(entry?.value);
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

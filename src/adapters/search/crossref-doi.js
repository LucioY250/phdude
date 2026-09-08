import { PhdudeError } from '../../domain/errors.js';
import { normalizeDoi } from '../../domain/normalize.js';
import { fetchWithPolicy, readJson, userAgent } from './http.js';

// One DOI, resolved against Crossref's `works/<DOI>` endpoint, for the citation auditor (spec
// §3.1). This is not a search provider: it answers "what does the registrar say this
// identifier is", so it takes one identifier and returns one record, and a DOI Crossref has
// never heard of is an answer rather than an error.

const NAME = 'crossref-doi';
const ENDPOINT = 'https://api.crossref.org/works';

// Crossref files a retraction as an `update-to` entry pointing back at the notice. The type is
// the machine-readable half and the label the human one; a registrar that fills in only the
// second must not hide a retraction.
const RETRACTION = /retract/i;

/**
 * @param {Function} fetch - injected so tests never reach the network
 * @param {string} doi
 * @param {{mailto?: string|null, version?: string, signal?: AbortSignal}} [options]
 * @returns {Promise<{doi: string, title: string|null, year: number|null, retracted: boolean,
 *   url: string|null}|null>} null when Crossref does not resolve the DOI
 */
export async function lookupDoi(fetch, doi, { mailto = null, version = '0.0.0', signal } = {}) {
  const normalized = normalizeDoi(doi);
  if (normalized === null) {
    throw new PhdudeError(
      'VALIDATION',
      `${NAME}: ${doi} is not a DOI`,
      'DOIs match ^10.\\d{4,9}/\\S+$',
    );
  }

  const url = new URL(`${ENDPOINT}/${encodeURIComponent(normalized)}`);
  // The polite pool, same bargain the search adapters make: a named caller gets the reliable lane.
  if (mailto) url.searchParams.set('mailto', mailto);

  const response = await fetchWithPolicy(fetch, url.href, {
    provider: NAME,
    headers: { 'user-agent': userAgent(version) },
    allowStatus: [404],
    signal,
  });

  if (response.status === 404) {
    if (typeof response.body?.cancel === 'function') await response.body.cancel();
    else if (typeof response.text === 'function') await response.text();
    return null;
  }

  const body = await readJson(response, NAME);
  const message = body?.message;
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    throw new PhdudeError(
      'VALIDATION',
      `${NAME}: response did not carry a message object`,
      'the provider may have changed its API',
    );
  }

  return {
    doi: normalized,
    title: stripMarkup(first(message.title)),
    year: yearOf(message),
    retracted: isRetracted(message),
    url: text(message.URL),
  };
}

function isRetracted(message) {
  if (!Array.isArray(message['update-to'])) return false;
  return message['update-to'].some(
    (update) =>
      RETRACTION.test(String(update?.type ?? '')) || RETRACTION.test(String(update?.label ?? '')),
  );
}

// `issued` is the date of record; `published` is what a preprint server files instead.
function yearOf(message) {
  for (const key of ['issued', 'published', 'published-online', 'published-print']) {
    const year = message?.[key]?.['date-parts']?.[0]?.[0];
    if (Number.isInteger(year)) return year;
  }
  return null;
}

// Crossref titles arrive as JATS XML, same as its abstracts.
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

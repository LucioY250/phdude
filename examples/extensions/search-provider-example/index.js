// SPDX-License-Identifier: MIT
//
// An example third-party PhDude SearchProvider. It queries a fictional literature API and maps
// its answers into PhDude's Candidate shape. Nothing here imports PhDude: the port is an
// interface, and this file is what implementing it from outside the package looks like.
//
// See docs/extension-api.md#searchprovider for the contract this satisfies.

const NAME = 'example-provider';
const ENDPOINT = 'https://api.example.org/v1/works';

const TIMEOUT_MS = 15_000;
const RETRY_ON = [429, 503];
const DEFAULT_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 2000;
const NETWORK_HINT = 'check your connection or the provider status';

// The provider's own vocabulary, mapped to the five types a Candidate may carry.
const TYPES = {
  'journal-article': 'article',
  'conference-paper': 'article',
  preprint: 'preprint',
  book: 'book',
  'book-chapter': 'chapter',
};

/**
 * @param {{fetch: Function, version?: string}} deps - `fetch` is injected, never imported, so a
 *   contract run replays recorded responses and never reaches the network
 * @returns {object} a SearchProvider
 */
export function exampleProvider({ fetch, version = '0.0.0' }) {
  return {
    name: NAME,

    async search(query, { from = null, limit = 20, signal } = {}) {
      const url = new URL(ENDPOINT);
      url.searchParams.set('q', String(query));
      url.searchParams.set('rows', String(limit));
      // This API filters by year server-side. A provider whose API cannot would set
      // `filtersDateClientSide: true` above and apply `from` to its own results instead.
      if (from) url.searchParams.set('from_year', String(from));

      const body = await fetchJson(fetch, url.href, { version, signal });
      if (!Array.isArray(body?.items)) {
        throw phdudeError(
          'VALIDATION',
          `${NAME}: response did not carry an items array`,
          'the provider may have changed its API',
        );
      }

      // `limit` is a promise the provider keeps whatever the API returned.
      return body.items.map(toCandidate).filter(Boolean).slice(0, limit);
    },
  };
}

function toCandidate(item) {
  const title = text(item?.title);
  const externalId = text(item?.id);
  // A work we cannot name or address is not a candidate a researcher could review.
  if (!title || !externalId) return null;

  return {
    provider: NAME,
    external_id: externalId,
    title,
    authors: Array.isArray(item?.authors) ? item.authors.map((a) => text(a)).filter(Boolean) : [],
    year: Number.isInteger(item?.year) ? item.year : null,
    venue: text(item?.venue),
    doi: normalizeDoi(item?.doi),
    url: text(item?.url),
    abstract: text(item?.abstract),
    type: TYPES[item?.type] ?? 'other',
    open_access: typeof item?.open_access === 'boolean' ? item.open_access : null,
    cited_by: Number.isInteger(item?.cited_by) && item.cited_by >= 0 ? item.cited_by : null,
  };
}

// A DOI is stored bare and lowercased, never as the resolver URL, so two providers that name the
// same work agree on the identity PhDude deduplicates on.
function normalizeDoi(value) {
  const raw = text(value);
  if (!raw) return null;
  const bare = raw.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(bare) ? bare : null;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function fetchJson(fetch, url, { version, signal }) {
  let response = await attempt(fetch, url, { version, signal });

  // Exactly one retry, on the statuses a provider uses to ask for one.
  if (RETRY_ON.includes(response.status)) {
    const backoff = retryAfterMs(response.headers.get('retry-after'));
    await discard(response);
    await sleep(backoff);
    response = await attempt(fetch, url, { version, signal });
  }

  if (!response.ok) {
    await discard(response);
    throw statusError(response.status);
  }

  try {
    return await response.json();
  } catch {
    throw phdudeError(
      'VALIDATION',
      `${NAME}: response was not valid JSON`,
      'the provider may be down or may have changed its API',
    );
  }
}

async function attempt(fetch, url, { version, signal }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  const timer = setTimeout(
    () => controller.abort(new Error(`timed out after ${TIMEOUT_MS}ms`)),
    TIMEOUT_MS,
  );

  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort);
  }

  try {
    return await fetch(url, {
      headers: { 'user-agent': `phdude-example-provider/${version}` },
      signal: controller.signal,
    });
  } catch (err) {
    // A transport failure, a timeout and the caller's own abort are all "the provider did not
    // answer", so all three reach the caller as one typed error naming this provider.
    const reason = controller.signal.reason?.message ?? err?.message ?? String(err);
    throw phdudeError('TOOL_MISSING', `${NAME}: ${reason}`, NETWORK_HINT);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

// A 4xx that is not rate limiting means we asked wrongly; everything else means the provider is
// unwell, which is a tool problem rather than the researcher's.
function statusError(status) {
  if (status >= 400 && status < 500 && status !== 429) {
    return phdudeError(
      'VALIDATION',
      `${NAME}: request rejected (HTTP ${status})`,
      'check the query and the provider filters',
    );
  }
  return phdudeError('TOOL_MISSING', `${NAME}: HTTP ${status}`, NETWORK_HINT);
}

function retryAfterMs(header) {
  const seconds = Number(header);
  if (header === null || header === '' || !Number.isFinite(seconds) || seconds < 0) {
    return DEFAULT_BACKOFF_MS;
  }
  return Math.min(MAX_BACKOFF_MS, Math.round(seconds * 1000));
}

// A response nobody will read still holds its connection until its body is consumed, so a
// rate-limited provider would otherwise leak one socket per call.
async function discard(response) {
  try {
    if (typeof response.body?.cancel === 'function') await response.body.cancel();
    else if (typeof response.text === 'function') await response.text();
  } catch {
    // A body already consumed or already gone is exactly the state this wanted.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// PhDude recognises its typed errors structurally - `name`, `code`, `hint` - so an extension
// living outside the package raises the same shape rather than importing the class.
function phdudeError(code, message, hint = null, details = null) {
  const err = new Error(message);
  err.name = 'PhdudeError';
  err.code = code;
  err.hint = hint;
  err.details = details;
  return err;
}

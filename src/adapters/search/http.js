import { PhdudeError } from '../../domain/errors.js';

const NETWORK_HINT = 'check your connection or provider status';
const MAX_BACKOFF_MS = 2000;
const DEFAULT_BACKOFF_MS = 1000;

/**
 * The identity every provider call carries, so an API owner can see who is asking.
 * @param {string} version
 * @returns {string}
 */
export function userAgent(version) {
  return `phdude/${version} (+https://github.com/LucioY250/phdude)`;
}

/**
 * How long to wait before the single retry: what the provider asked for, capped so a search
 * never stalls on a hostile header.
 * @param {string|null} header - the Retry-After response header, in seconds
 * @returns {number} milliseconds
 */
export function retryAfterMs(header) {
  const seconds = Number(header);
  if (header === null || header === '' || !Number.isFinite(seconds) || seconds < 0) {
    return DEFAULT_BACKOFF_MS;
  }
  return Math.min(MAX_BACKOFF_MS, Math.round(seconds * 1000));
}

/**
 * One HTTP request under the search policy: a bounded timeout, one retry on the statuses a
 * provider uses to ask for one, and typed errors that name the provider they came from.
 * @param {Function} fetch - injected so tests never reach the network
 * @param {string} url
 * @param {{provider?: string, headers?: Record<string, string>, timeoutMs?: number,
 *   retryOn?: number[], signal?: AbortSignal}} options
 * @returns {Promise<object>} the successful Response
 */
export async function fetchWithPolicy(
  fetch,
  url,
  { provider = 'search', headers = {}, timeoutMs = 15000, retryOn = [429, 503], signal } = {},
) {
  let response = await attempt(fetch, url, { provider, headers, timeoutMs, signal });

  if (retryOn.includes(response.status)) {
    await sleep(retryAfterMs(response.headers.get('retry-after')));
    response = await attempt(fetch, url, { provider, headers, timeoutMs, signal });
  }

  if (response.ok) return response;
  throw statusError(provider, response.status);
}

async function attempt(fetch, url, { provider, headers, timeoutMs, signal }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  const timer = setTimeout(
    () => controller.abort(new Error(`timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );

  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort);
  }

  try {
    return await fetch(url, { headers, signal: controller.signal });
  } catch (err) {
    // A transport failure, a timeout and a caller's abort are all "the provider did not
    // answer": the search reports it and moves on rather than crashing the command.
    const reason = controller.signal.reason?.message ?? err?.message ?? String(err);
    throw new PhdudeError('TOOL_MISSING', `${provider}: ${reason}`, NETWORK_HINT);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function statusError(provider, status) {
  // A 4xx that is not rate limiting means we asked wrongly; everything else means the provider
  // is unwell, which is a tool problem rather than the researcher's.
  if (status >= 400 && status < 500 && status !== 429) {
    return new PhdudeError(
      'VALIDATION',
      `${provider}: request rejected (HTTP ${status})`,
      'check the query and the provider filters',
    );
  }
  return new PhdudeError('TOOL_MISSING', `${provider}: HTTP ${status}`, NETWORK_HINT);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The response body, parsed. Provider responses are untrusted input (PRD S74): a body that is
 * not JSON is the provider's fault, and the search reports it as one rather than throwing a
 * SyntaxError from inside the mapper.
 * @param {object} response
 * @param {string} provider
 * @returns {Promise<unknown>}
 */
export async function readJson(response, provider) {
  try {
    return await response.json();
  } catch {
    throw new PhdudeError(
      'VALIDATION',
      `${provider}: response was not valid JSON`,
      'the provider may be down or may have changed its API',
    );
  }
}

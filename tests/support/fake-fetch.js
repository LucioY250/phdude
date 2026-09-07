/**
 * A `fetch`-compatible function backed by recorded routes, so no test ever reaches the network.
 *
 * A route matches by substring (string) or pattern (RegExp), in declaration order; `times`
 * limits how often a route may match, which is how "429 first, then 200" is expressed. An
 * unmatched URL throws rather than falling through to the real network.
 *
 * @param {{match: string|RegExp, status?: number, body?: string|object,
 *   headers?: Record<string, string>, delayMs?: number, times?: number}[]} routes
 * @returns {((url: string|URL, init?: object) => Promise<object>) & {calls: {url: string, init: object}[]}}
 */
export function fakeFetch(routes) {
  const remaining = routes.map((route) => ({ route, left: route.times ?? Infinity }));
  const calls = [];

  const fn = async (url, init = {}) => {
    const href = String(url);
    calls.push({ url: href, init });

    if (init.signal?.aborted) throw abortError();

    const entry = remaining.find((e) => e.left > 0 && matches(e.route.match, href));
    if (!entry) throw new Error(`fakeFetch: no route matches ${href}`);
    entry.left -= 1;

    if (entry.route.delayMs) await sleep(entry.route.delayMs, init.signal);

    return response(entry.route);
  };

  fn.calls = calls;
  return fn;
}

function matches(match, href) {
  return match instanceof RegExp ? match.test(href) : href.includes(String(match));
}

function response(route) {
  const status = route.status ?? 200;
  const body = typeof route.body === 'string' ? route.body : JSON.stringify(route.body ?? {});
  const headers = new Map(
    Object.entries(route.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
    async json() {
      return JSON.parse(body);
    },
    async text() {
      return body;
    },
  };
}

function abortError() {
  const err = new Error('This operation was aborted');
  err.name = 'AbortError';
  return err;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort);
    }
  });
}

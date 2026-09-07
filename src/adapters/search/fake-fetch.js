import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * A `fetch`-compatible function backed by recorded routes, so no test ever reaches the network.
 *
 * A route matches by substring (string) or pattern (RegExp), in declaration order; `times`
 * limits how often a route may match, which is how "429 first, then 200" is expressed. An
 * unmatched URL throws rather than falling through to the real network.
 *
 * This lives under `src/` rather than `tests/` only because `run.js` needs it for the
 * `PHDUDE_FAKE_FETCH` hook (see below). It is a test helper; nothing in a real run reaches it.
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

/**
 * Builds a `fakeFetch` from a JSON routes file. `match` is a substring, and a route may name a
 * `bodyFile` relative to the routes file instead of carrying its body inline, so a fixture can
 * reuse the recorded provider responses. Internal, test-only: this is what `PHDUDE_FAKE_FETCH`
 * points at, and it is documented as such in docs/cli.md.
 * @param {string} path
 * @returns {Promise<Function>}
 */
export async function fakeFetchFromFile(path) {
  const routes = JSON.parse(await readFile(path, 'utf8'));
  const base = dirname(path);
  return fakeFetch(
    await Promise.all(
      routes.map(async (route) => {
        if (route.bodyFile === undefined) return route;
        const { bodyFile, ...rest } = route;
        return { ...rest, body: await readFile(resolve(base, bodyFile), 'utf8') };
      }),
    ),
  );
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

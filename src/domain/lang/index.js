import { en } from './en.js';
import { es } from './es.js';

// The languages with prose resources. A language absent from this table is not an error: the
// text statistics drop their language-dependent fields and the lint runs its structural rules
// only, reported as an `info` observation (PRD §101).
export const TABLES = { en, es };

/**
 * The prose resources for a language tag, or null when none ship for it.
 * `es-ES`, `ES` and `es` all resolve to the Spanish table; anything else resolves to null.
 * @param {string|null|undefined} lang - a BCP-47 tag or a bare language code
 * @returns {object|null}
 */
export function tableFor(lang) {
  if (typeof lang !== 'string') return null;
  const code = lang.trim().toLowerCase().split(/[-_]/)[0];
  return TABLES[code] ?? null;
}

/**
 * The primary subtag of a language tag, lowercased, or null when there is nothing to normalize.
 * Reported back in `stats()` so a caller can tell which language the numbers describe.
 * @param {string|null|undefined} lang
 * @returns {string|null}
 */
export function normalizeLang(lang) {
  if (typeof lang !== 'string') return null;
  const code = lang.trim().toLowerCase().split(/[-_]/)[0];
  return code === '' ? null : code;
}

export { en, es };

// Meaning preservation (spec §3.4, gate 5): a revision may change how a section reads, never
// what it says. What it says is recorded as four multisets - the claims it asserts, the sources
// it cites, the numbers it states and the negations it carries - and a revision that drops any
// of them blocks. Adding a claim or a citation blocks too, unless the researcher asked for it
// with `--allow-additions`: new assertions belong to a draft, not to a cleanup pass.

import { stripMarkup } from '../textstats.js';
import { citationsIn } from './citations.js';

const NAME = 'gate-meaning';
const CLAIM_RE = /<!--\s*claim\s*:\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s*-->/gi;
const NUMERAL_RE = /\p{Nd}[\p{Nd}.,]*\p{Nd}|\p{Nd}/gu;

// Negation is meaning: "does not reduce" and "reduces" are different findings. The cues are
// counted as a multiset rather than matched sentence by sentence, so rewording a negated
// sentence is allowed and losing one of its negations is not.
const NEGATIONS = {
  en: [
    'not',
    'no',
    'never',
    'without',
    'nor',
    'neither',
    'fails to',
    'failed to',
    'cannot',
    'unable to',
  ],
  es: ['no', 'ni', 'nunca', 'jamás', 'sin', 'tampoco', 'ninguno', 'ninguna'],
};

function negationCues(lang) {
  const code = String(lang ?? 'en')
    .toLowerCase()
    .split(/[-_]/)[0];
  return NEGATIONS[code] ?? NEGATIONS.en;
}

function countCue(text, cue) {
  const escaped = cue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = /^\p{L}/u.test(cue) ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped;
  return (text.match(new RegExp(pattern, 'giu')) ?? []).length;
}

function tally(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

/**
 * What a text asserts, as four multisets.
 * @param {string} text
 * @param {string} [lang]
 * @returns {{claims: Map<string, number>, citations: Map<string, number>,
 *   numerals: Map<string, number>, negations: Map<string, number>}}
 */
export function signature(text, lang) {
  const source = String(text ?? '');
  const prose = stripMarkup(source);
  const negations = new Map();
  for (const cue of negationCues(lang)) {
    const n = countCue(prose, cue);
    if (n > 0) negations.set(cue, n);
  }
  return {
    claims: tally([...source.matchAll(CLAIM_RE)].map((m) => m[1])),
    citations: tally(citationsIn(source).map((c) => c.key)),
    numerals: tally(prose.match(NUMERAL_RE) ?? []),
    negations,
  };
}

function missing(before, after) {
  const gone = [];
  for (const [value, count] of before) {
    const left = after.get(value) ?? 0;
    for (let i = left; i < count; i++) gone.push(value);
  }
  return gone.sort();
}

/**
 * @param {string} oldText
 * @param {string} newText
 * @param {string} [lang]
 * @returns {{removed: {claims: string[], citations: string[], numerals: string[],
 *   negations: string[]}, added: {claims: string[], citations: string[]}}}
 */
export function diff(oldText, newText, lang) {
  const before = signature(oldText, lang);
  const after = signature(newText, lang);
  return {
    removed: {
      claims: missing(before.claims, after.claims),
      citations: missing(before.citations, after.citations),
      numerals: missing(before.numerals, after.numerals),
      negations: missing(before.negations, after.negations),
    },
    added: {
      claims: missing(after.claims, before.claims),
      citations: missing(after.citations, before.citations),
    },
  };
}

const REMOVED = {
  claims: [
    'claim',
    'restore the <!-- claim: … --> marker, or reopen the section and submit a new draft',
  ],
  citations: ['citation', 'a revision keeps every source the section cited; put the [@key] back'],
  numerals: ['number', 'a revision may reword a number, never drop it'],
  negations: [
    'negation',
    'losing a negation reverses the finding; keep the "not", "no" or "without"',
  ],
};

export const meaningGate = {
  name: NAME,

  /**
   * @param {string} text - the revised section body
   * @param {{revisionOf?: string|null, allowAdditions?: boolean, lang?: string}} ctx
   * @returns {object[]} findings; none at all when there is nothing to revise against
   */
  run(text, ctx) {
    if (typeof ctx?.revisionOf !== 'string') return [];

    const changes = diff(ctx.revisionOf, text, ctx.lang);
    const findings = [];

    for (const [key, [label, hint]] of Object.entries(REMOVED)) {
      for (const value of changes.removed[key]) {
        findings.push({
          gate: NAME,
          severity: 'block',
          line: 1,
          message: `the revision drops the ${label} ${value}`,
          hint,
        });
      }
    }

    if (ctx.allowAdditions !== true) {
      for (const value of changes.added.claims) {
        findings.push({
          gate: NAME,
          severity: 'block',
          line: 1,
          message: `the revision asserts a claim the section did not assert: ${value}`,
          hint: 'a revision preserves meaning; pass --allow-additions if the new assertion is intended',
        });
      }
      for (const value of changes.added.citations) {
        findings.push({
          gate: NAME,
          severity: 'block',
          line: 1,
          message: `the revision cites a source the section did not cite: ${value}`,
          hint: 'a revision preserves meaning; pass --allow-additions if the new citation is intended',
        });
      }
    }

    return findings;
  },
};

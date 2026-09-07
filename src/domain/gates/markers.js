// What the prose says it rests on: the `<!-- claim: -->`, `<!-- fact: -->` and `<!-- result: -->`
// markers an agent writes into a draft, resolved against the workspace, plus the numerals that
// carry no marker at all. `gate-evidence` turns this inventory into findings and `gate-prose`
// hands its counts to the prose lint, so both gates read the same reading of the same draft.

import { lineAt, paragraphs, sentenceSpans, stripMarkup } from '../textstats.js';

const MARKER_RE = /<!--\s*(claim|fact|result)\s*:\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s*-->/gi;
const CITATION = /\[@[^\]]+\]/;
const NUMERAL = /\p{Nd}[\p{Nd}.,]*\p{Nd}/u;

// The verbs a state may not use, from `skills/academic-prose/references/epistemic-language.md`.
// A claim's evidence outranks its state: evidence that is entirely `weak` forbids the same verbs
// a candidate claim forbids, whatever the claim was promoted to.
//
// Both third-person forms are listed per verb. "The data demonstrate" and "the data demonstrates"
// overreach identically, and a plural subject - data, findings, results, los datos - is the
// ordinary way to write the sentence, so matching the singular alone would let it through.
const EPISTEMIC = {
  en: {
    candidate: [
      'demonstrate',
      'demonstrates',
      'show',
      'shows',
      'prove',
      'proves',
      'establish',
      'establishes',
    ],
    disputed: [
      'demonstrate',
      'demonstrates',
      'show',
      'shows',
      'prove',
      'proves',
      'establish',
      'establishes',
    ],
    supported: ['demonstrate', 'demonstrates', 'prove', 'proves'],
    canonical: ['prove', 'proves'],
    weak: ['show', 'shows', 'demonstrate', 'demonstrates'],
  },
  es: {
    candidate: [
      'demuestra',
      'demuestran',
      'muestra',
      'muestran',
      'prueba',
      'prueban',
      'establece',
      'establecen',
    ],
    disputed: [
      'demuestra',
      'demuestran',
      'muestra',
      'muestran',
      'prueba',
      'prueban',
      'establece',
      'establecen',
    ],
    supported: ['demuestra', 'demuestran', 'prueba', 'prueban'],
    canonical: ['prueba', 'prueban'],
    weak: ['muestra', 'muestran', 'demuestra', 'demuestran'],
  },
};

function tableFor(lang) {
  const code = String(lang ?? 'en')
    .toLowerCase()
    .split(/[-_]/)[0];
  return EPISTEMIC[code] ?? null;
}

function forbiddenVerbs(table, claim) {
  if (!table || !claim) return [];
  const byState = table[claim.state] ?? [];
  const byStrength = claim.allWeak ? table.weak : [];
  return [...new Set([...byState, ...byStrength])];
}

function verbHits(text, verbs) {
  const clean = stripMarkup(text).toLowerCase();
  return verbs.filter((verb) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${verb}(?![\\p{L}\\p{N}])`, 'u').test(clean),
  );
}

// A claim resolved against the workspace: its state, the strength of every evidence item behind
// it, and whether that evidence is entirely weak.
function resolveClaim(id, ctx) {
  const claim = ctx.claimsById?.get(id);
  if (!claim) return { id, resolved: false, state: null, strengths: [], allWeak: false };
  const strengths = (claim.supported_by ?? [])
    .map((evId) => ctx.evidenceById?.get(evId)?.strength)
    .filter(Boolean);
  return {
    id,
    resolved: true,
    state: claim.state ?? null,
    strengths,
    allWeak: strengths.length > 0 && strengths.every((s) => s === 'weak'),
  };
}

/**
 * @param {string} text - the section body
 * @param {{claimsById?: Map<string, object>, evidenceById?: Map<string, object>,
 *   factIds?: Set<string>, resultIds?: Set<string>, lang?: string}} ctx
 * @returns {{claims: object[], facts: object[], results: object[], numerals: object[],
 *   overreach: object[]}} every marker in document order, each located; `numerals` holds only
 *   the sentences whose numeral has neither a marker nor a citation; `overreach` holds one
 *   entry per forbidden verb found in a paragraph that asserts a claim
 */
export function markerInventory(text, ctx = {}) {
  const source = String(text ?? '');
  const table = tableFor(ctx.lang);
  const claims = [];
  const facts = [];
  const results = [];

  for (const match of source.matchAll(MARKER_RE)) {
    const kind = match[1].toLowerCase();
    const line = lineAt(source, match.index);
    if (kind === 'claim') {
      claims.push({ ...resolveClaim(match[2], ctx), line });
    } else if (kind === 'fact') {
      facts.push({ id: match[2], line, resolved: ctx.factIds?.has(match[2]) === true });
    } else {
      results.push({ id: match[2], line, resolved: ctx.resultIds?.has(match[2]) === true });
    }
  }

  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const overreach = [];
  const numerals = [];

  for (const paragraph of paragraphs(source)) {
    const asserted = [
      ...new Set(
        [...paragraph.text.matchAll(MARKER_RE)]
          .filter((m) => m[1].toLowerCase() === 'claim')
          .map((m) => m[2]),
      ),
    ];
    const spans = sentenceSpans(paragraph.text, ctx.lang);

    for (const id of asserted) {
      const claim = claimById.get(id);
      const verbs = verbHits(paragraph.text, forbiddenVerbs(table, claim));
      for (const verb of verbs) {
        overreach.push({
          claim: id,
          verb,
          state: claim.state,
          allWeak: claim.allWeak,
          line: paragraph.line,
        });
      }
    }

    for (const span of spans) {
      if (CITATION.test(span.text)) continue;
      if (/<!--\s*(?:fact|result)\s*:/i.test(span.text)) continue;
      const clean = stripMarkup(span.text);
      const hit = NUMERAL.exec(clean);
      if (!hit) continue;
      numerals.push({
        numeral: hit[0],
        line: paragraph.line + lineAt(paragraph.text, span.index) - 1,
        excerpt: span.text,
      });
    }
  }

  return { claims, facts, results, numerals, overreach };
}

/**
 * The counts the prose lint scores against (see `FORMULAS` in domain/prose-lint.js).
 * @param {object} inventory - from `markerInventory`
 * @returns {{markers: number, unresolved: number, rejected: number, overreach: number,
 *   weaklySupported: number, unmarkedNumerals: number}}
 */
export function markerCounts(inventory) {
  const all = [...inventory.claims, ...inventory.facts, ...inventory.results];
  return {
    markers: all.length,
    unresolved: all.filter((marker) => !marker.resolved).length,
    rejected: inventory.claims.filter((claim) => claim.state === 'rejected').length,
    overreach: inventory.overreach.length,
    weaklySupported: inventory.claims.filter(
      (claim) => claim.resolved && (claim.strengths.length === 0 || claim.allWeak),
    ).length,
    unmarkedNumerals: inventory.numerals.length,
  };
}

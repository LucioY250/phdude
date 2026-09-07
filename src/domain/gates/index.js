// The writing pipeline's gate runner (spec §3.4). A gate is `{ name, run(text, ctx) }` and
// returns located findings `{ gate, severity: 'block'|'warn'|'info', line, message, hint }`, or
// `{ findings, scores }` when it also measures something (only `gate-prose` does).
// Pure: every gate is handed the text and a context the application layer assembled, so a gate
// never reaches the store and the runner never decides what to do about a block - `submit` does.

import { citationsGate } from './citations.js';
import { evidenceGate } from './evidence.js';
import { meaningGate } from './meaning.js';
import { profileGate } from './profile.js';
import { proseGate } from './prose.js';
import { voiceGate } from './voice.js';

// Registration order, which is the order findings are reported in: what the prose rests on
// first, how it reads second, what a revision must not lose last.
export const GATES = {
  'gate-citations': citationsGate,
  'gate-evidence': evidenceGate,
  'gate-prose': proseGate,
  'gate-voice': voiceGate,
  'gate-meaning': meaningGate,
  'gate-profile': profileGate,
};

/**
 * The gates a run uses when the caller does not name them: all of them, except that
 * `gate-meaning` needs something to compare against and so only runs on a revision.
 * @param {{revisionOf?: string|null}} [options]
 * @returns {object[]}
 */
export function defaultGates({ revisionOf = null } = {}) {
  return Object.values(GATES).filter(
    (gate) => gate.name !== 'gate-meaning' || typeof revisionOf === 'string',
  );
}

function normalize(produced) {
  if (Array.isArray(produced)) return { findings: produced, scores: null };
  return { findings: produced?.findings ?? [], scores: produced?.scores ?? null };
}

/**
 * @param {string} text - the section body, front matter excluded
 * @param {object} ctx - whatever the gates in this run need; assembled by application/
 * @param {{revisionOf?: string|null, mode?: string, allowAdditions?: boolean,
 *   gates?: object[]}} [options] - `revisionOf` is the section body being revised, `mode` the
 *   workspace review mode (PRD §40), `allowAdditions` the researcher's opt-in to new claims
 * @returns {{findings: object[], blocked: boolean, scores: object,
 *   gates: {gate: string, findings: number, blocked: boolean}[]}}
 */
export function runGates(text, ctx, options = {}) {
  const { revisionOf = null, mode = 'full', allowAdditions = false } = options;
  const gates = options.gates ?? defaultGates({ revisionOf });
  const runCtx = { ...ctx, revisionOf, mode, allowAdditions };

  const findings = [];
  const rows = [];
  let scores = {};

  for (const gate of gates) {
    const produced = normalize(gate.run(text, runCtx));
    findings.push(...produced.findings);
    if (produced.scores) scores = { ...scores, ...produced.scores };
    rows.push({
      gate: gate.name,
      findings: produced.findings.length,
      blocked: produced.findings.some((finding) => finding.severity === 'block'),
    });
  }

  return { findings, blocked: rows.some((row) => row.blocked), scores, gates: rows };
}

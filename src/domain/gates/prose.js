// Prose lint as a gate (spec §3.4, gate 3). The rules live in domain/prose-lint.js and are the
// same ones `phdude prose --file` runs; this wraps them for the writing pipeline, hands them the
// marker inventory so the evidence-backed sub-scores can be computed, and applies the review
// mode (PRD §40): `ruthless` turns every warning into a block, `lite` reports them as `info`.

import { lint } from '../prose-lint.js';
import { markerCounts, markerInventory } from './markers.js';

const NAME = 'gate-prose';

export const proseGate = {
  name: NAME,

  /**
   * @param {string} text
   * @param {object} ctx - the gate context; `lang`, `mode` and the entity maps the markers
   *   resolve against
   * @returns {{findings: object[], scores: object}}
   */
  run(text, ctx) {
    const mode = ctx?.mode ?? 'full';
    const report = lint(text, {
      lang: ctx?.lang,
      mode: mode === 'ruthless' ? 'ruthless' : 'full',
      markers: markerCounts(markerInventory(text, ctx ?? {})),
      profile: ctx?.voiceProfile ?? null,
    });

    // `off` is the researcher saying they do not want the review (PRD §40). The scores are
    // still computed - the report is not a review - but nothing is reported as a finding.
    if (mode === 'off') return { findings: [], scores: report.scores };

    const findings = report.observations.map((observation) => ({
      gate: NAME,
      severity: mode === 'lite' && observation.severity === 'warn' ? 'info' : observation.severity,
      line: observation.line,
      message:
        observation.excerpt === ''
          ? `${observation.rule}: ${observation.message}`
          : `${observation.rule}: ${observation.message} — "${observation.excerpt}"`,
      hint: observation.hint,
    }));

    return { findings, scores: report.scores };
  },
};

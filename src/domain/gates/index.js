// The writing pipeline's gate runner (spec §3.4). A gate is `{ name, run(text, ctx) }` and
// returns located findings `{ gate, severity: 'block'|'warn'|'info', line, message, hint }`.
// Pure: every gate is handed the text and a context the application layer assembled, so a gate
// never reaches the store and the runner never decides what to do about a block - `submit` does.

/**
 * @param {string} text - the section body, front matter excluded
 * @param {object} ctx - whatever the gates in this run need; assembled by application/
 * @param {{gates: {name: string, run: (text: string, ctx: object) => object[]}[]}} options
 * @returns {{findings: object[], blocked: boolean,
 *   gates: {gate: string, findings: number, blocked: boolean}[]}}
 */
export function runGates(text, ctx, { gates }) {
  const findings = [];
  const rows = [];

  for (const gate of gates) {
    const produced = gate.run(text, ctx) ?? [];
    findings.push(...produced);
    rows.push({
      gate: gate.name,
      findings: produced.length,
      blocked: produced.some((finding) => finding.severity === 'block'),
    });
  }

  return { findings, blocked: rows.some((row) => row.blocked), gates: rows };
}

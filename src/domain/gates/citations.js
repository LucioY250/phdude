// Citation audit (spec §3.4, gate 1): every `[@key]` in the prose has to resolve to a source
// the workspace records, by SRC id or by bibkey, and the source behind it has to still be one
// the researcher accepted. Both failures block: prose that cites what the registry cannot
// name is prose that outran the evidence.

const CITATION_RE = /\[@([A-Za-z0-9][A-Za-z0-9_:.-]*)\]/g;

/**
 * @param {string} text
 * @returns {{key: string, line: number}[]} in document order, lines 1-based
 */
export function citationsIn(text) {
  const source = String(text ?? '');
  const found = [];
  for (const match of source.matchAll(CITATION_RE)) {
    const line = source.slice(0, match.index).split('\n').length;
    found.push({ key: match[1], line });
  }
  return found;
}

export const citationsGate = {
  name: 'gate-citations',

  /**
   * @param {string} text
   * @param {{sourcesById: Map<string, object>, sourcesByBibkey: Map<string, object>,
   *   dismissedSources: Map<string, string>}} ctx - `dismissedSources` maps a source id to the
   *   dismissed candidate it was accepted from
   * @returns {object[]} findings
   */
  run(text, ctx) {
    const findings = [];

    for (const { key, line } of citationsIn(text)) {
      const source = ctx.sourcesById.get(key) ?? ctx.sourcesByBibkey.get(key);

      if (!source) {
        findings.push({
          gate: citationsGate.name,
          severity: 'block',
          line,
          message: `[@${key}] does not resolve to a recorded source`,
          hint: 'phdude cite list shows every source and its bibkey; accept the candidate first if it is not in the registry',
        });
        continue;
      }

      const dismissed = ctx.dismissedSources.get(source.id);
      if (dismissed) {
        findings.push({
          gate: citationsGate.name,
          severity: 'block',
          line,
          message: `[@${key}] cites ${source.id}, accepted from the dismissed candidate ${dismissed}`,
          hint: 'the researcher dismissed that candidate; cite another source or reopen the dismissal',
        });
      }
    }

    return findings;
  },
};

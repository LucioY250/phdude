// Evidence fidelity (spec §3.4, gate 2): the prose may not assert more than the workspace
// records. A marker that names nothing, a rejected claim asserted anyway, a verb stronger than
// the claim's state allows - each of those is prose outrunning the evidence, and each blocks.
// A numeral standing on its own is weaker than that: it is reported, not refused, because a
// number can legitimately come from a cited source.

import { markerInventory } from './markers.js';

const NAME = 'gate-evidence';

function finding(severity, line, message, hint) {
  return { gate: NAME, severity, line, message, hint };
}

const HINTS = {
  claim: 'phdude knowledge list --type claim shows every claim and its id',
  fact: 'phdude add fact records the number before it reaches the prose',
  result: 'phdude add result records the number before it reaches the prose',
};

function unresolved(marker, kind) {
  return finding(
    'block',
    marker.line,
    `<!-- ${kind}: ${marker.id} --> names no ${kind} in this workspace`,
    HINTS[kind],
  );
}

export const evidenceGate = {
  name: NAME,

  /**
   * @param {string} text
   * @param {{claimsById: Map<string, object>, evidenceById: Map<string, object>,
   *   factIds: Set<string>, resultIds: Set<string>, lang?: string}} ctx
   * @returns {object[]} findings
   */
  run(text, ctx) {
    const inventory = markerInventory(text, ctx);
    const findings = [];

    for (const claim of inventory.claims) {
      if (!claim.resolved) {
        findings.push(unresolved(claim, 'claim'));
        continue;
      }
      if (claim.state === 'rejected') {
        findings.push(
          finding(
            'block',
            claim.line,
            `${claim.id} is rejected and this paragraph asserts it`,
            'a rejected claim is not knowledge; drop the paragraph or reopen the claim with a Decision',
          ),
        );
      }
    }
    for (const fact of inventory.facts) {
      if (!fact.resolved) findings.push(unresolved(fact, 'fact'));
    }
    for (const result of inventory.results) {
      if (!result.resolved) findings.push(unresolved(result, 'result'));
    }

    for (const hit of inventory.overreach) {
      const because = hit.allWeak
        ? `${hit.claim} rests on weak evidence only`
        : `${hit.claim} is ${hit.state}`;
      findings.push(
        finding(
          'block',
          hit.line,
          `"${hit.verb}" claims more than the evidence supports: ${because}`,
          'see skills/academic-prose/references/epistemic-language.md for the verb each state allows',
        ),
      );
    }

    for (const numeral of inventory.numerals) {
      findings.push(
        finding(
          'warn',
          numeral.line,
          `the numeral ${numeral.numeral} has no fact or result marker and no citation in its sentence`,
          'mark it with <!-- fact: FACT-… --> or <!-- result: RESULT-… -->, or cite the source it came from',
        ),
      );
    }

    return findings.sort((a, b) => a.line - b.line);
  },
};

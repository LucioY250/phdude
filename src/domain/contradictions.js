import { PhdudeError } from './errors.js';
import { canTransition } from './states.js';

function addContradiction(claim, otherId) {
  const set = new Set(claim.contradicts ?? []);
  set.add(otherId);
  return { ...claim, contradicts: [...set].sort() };
}

/**
 * Pure. Records a symmetric `contradicts` relation between two claims and, for each side
 * independently, moves it to `disputed` when the state machine allows the transition
 * (candidate/supported/canonical); a claim already `disputed` or `rejected` keeps its state.
 * @param {object} a
 * @param {object} b
 * @returns {{a: object, b: object, changed: string[]}} `changed` lists the ids whose state
 *   actually moved to `disputed`.
 */
export function markContradiction(a, b) {
  if (a.id === b.id) {
    throw new PhdudeError('USAGE', 'a claim cannot contradict itself');
  }

  const changed = [];
  let nextA = addContradiction(a, b.id);
  let nextB = addContradiction(b, a.id);

  if (canTransition(nextA.state, 'disputed')) {
    nextA = { ...nextA, state: 'disputed' };
    changed.push(a.id);
  }
  if (canTransition(nextB.state, 'disputed')) {
    nextB = { ...nextB, state: 'disputed' };
    changed.push(b.id);
  }

  return { a: nextA, b: nextB, changed: changed.sort() };
}

/**
 * Pure. The ids this claim contradicts that are still live: the claim behind the id exists and
 * is not `rejected`. Rejecting a claim is how a contradiction is settled (PRD §3.5), so a
 * rejected opponent is history rather than an open dispute.
 * @param {object} claim
 * @param {Map<string, object>} claimsById
 * @returns {string[]}
 */
export function liveContradictions(claim, claimsById) {
  return (claim.contradicts ?? []).filter((id) => {
    const other = claimsById.get(id);
    return other !== undefined && other.state !== 'rejected';
  });
}

/**
 * Pure. Pairs of claims in a live contradiction, derived from the `contradicts` field: both
 * sides reference each other and neither has been `rejected`, whatever states they are in. A
 * pair is reported once, ids sorted within the pair, pairs sorted by first then second id. A
 * pair drops out once one side is rejected - `contradicts` itself is left as history.
 * @param {object[]} claims
 * @returns {[string, string][]}
 */
export function disputedPairs(claims) {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const seen = new Set();
  const pairs = [];

  for (const claim of claims) {
    if (claim.state === 'rejected') continue;
    for (const otherId of liveContradictions(claim, byId)) {
      const other = byId.get(otherId);
      if (!(other.contradicts ?? []).includes(claim.id)) continue;

      const [lo, hi] = claim.id < otherId ? [claim.id, otherId] : [otherId, claim.id];
      const key = `${lo} ${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([lo, hi]);
    }
  }

  pairs.sort(([a1, b1], [a2, b2]) => a1.localeCompare(a2) || b1.localeCompare(b2));
  return pairs;
}

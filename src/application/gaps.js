import { detectFactConflicts } from '../domain/conflicts.js';
import { findGaps } from '../domain/gaps.js';
import { loadSnapshot } from './snapshot.js';

/**
 * @param {{store: object, clock?: () => string}} deps
 * @returns {Promise<{gaps: object[], counts: {high: number, medium: number, low: number}}>}
 */
export async function gaps({ store, clock }) {
  const snapshot = await loadSnapshot(store, clock);
  const conflicts = detectFactConflicts(snapshot.facts, snapshot.decisions);
  const gapsList = findGaps(snapshot, conflicts);

  const counts = { high: 0, medium: 0, low: 0 };
  for (const g of gapsList) counts[g.severity]++;

  return { gaps: gapsList, counts };
}

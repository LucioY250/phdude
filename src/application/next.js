import { loadSnapshot } from './snapshot.js';
import { detectFactConflicts } from '../domain/conflicts.js';
import { recommendNext } from '../domain/next.js';

/**
 * @param {{store: object}} deps
 * @returns {Promise<{actions: object[], top: object}>}
 */
export async function next({ store }) {
  const snapshot = await loadSnapshot(store);
  const conflicts = detectFactConflicts(snapshot.facts, snapshot.decisions);
  const actions = recommendNext(snapshot, conflicts);
  return { actions, top: actions[0] };
}

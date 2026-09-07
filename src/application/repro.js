import { reproCounts } from '../domain/repro.js';
import { loadSnapshot } from './snapshot.js';

/**
 * Every analysis, table and figure in the workspace, and whether what is on disk still follows
 * from what is recorded. It is a report: nothing here is an error, because the answer to all of
 * it is to re-run or rebuild, and that is the researcher's call.
 * @param {{store: object, clock?: () => string}} deps
 * @returns {Promise<{items: object[], counts: Record<string, number>, attention: number}>}
 */
export async function check({ store, clock }) {
  const items = (await loadSnapshot(store, clock)).repro;
  return {
    items,
    counts: reproCounts(items),
    attention: items.filter((item) => item.status !== 'up-to-date').length,
  };
}

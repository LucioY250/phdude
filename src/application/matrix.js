import { assignBibkeys } from '../domain/bibkey.js';
import { buildMatrix } from '../domain/matrix.js';
import { PhdudeError } from '../domain/errors.js';
import { loadSnapshot } from './snapshot.js';

const FORMATS = ['md', 'csv'];

/**
 * @param {{store: object}} deps
 * @param {{format?: 'md'|'csv', question?: string}} opts
 * @returns {Promise<{rows: object[], format: string}>}
 */
export async function matrix({ store }, { format = 'md', question } = {}) {
  if (!FORMATS.includes(format)) {
    throw new PhdudeError(
      'USAGE',
      `unknown matrix format: ${format}`,
      `valid formats: ${FORMATS.join(', ')}`,
    );
  }

  const snapshot = await loadSnapshot(store);
  const keys = assignBibkeys(snapshot.sources);
  const rows = buildMatrix(snapshot, { keys, question });
  return { rows, format };
}

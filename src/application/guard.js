import { PhdudeError } from '../domain/errors.js';
import {
  CURRENT_WORKSPACE_VERSION,
  needsMigration,
  workspaceVersionOf,
} from '../domain/versioning.js';

/**
 * @param {object|null} project
 * @returns {string|null} the warning reads report, null when the workspace is current or absent
 */
export function migrationWarning(project) {
  if (project === null || project === undefined || !needsMigration(project)) return null;
  return `workspace needs migration (${workspaceVersionOf(project)} → ${CURRENT_WORKSPACE_VERSION})`;
}

/**
 * Writing into a workspace whose objects predate the current schema would mix shapes the rest
 * of the CLI assumes are uniform, so every mutating use case stops here first. Reads never do:
 * they warn instead (see application/snapshot.js), so a researcher can still look around.
 * @param {object|null} project
 */
export function assertUpToDate(project) {
  const warning = migrationWarning(project);
  if (warning) throw new PhdudeError('USAGE', warning, 'run phdude migrate');
}

import { PhdudeError } from '../domain/errors.js';
import {
  CURRENT_WORKSPACE_VERSION,
  isNewerThanRuntime,
  needsMigration,
  workspaceVersionOf,
} from '../domain/versioning.js';

/**
 * @param {object|null} project
 * @returns {string|null} the warning reads report, null when the workspace is current or absent
 */
export function migrationWarning(project) {
  if (project === null || project === undefined) return null;
  if (isNewerThanRuntime(project)) {
    return `workspace version ${workspaceVersionOf(project)} is newer than this PhDude (${CURRENT_WORKSPACE_VERSION})`;
  }
  if (!needsMigration(project)) return null;
  return `workspace needs migration (${workspaceVersionOf(project)} → ${CURRENT_WORKSPACE_VERSION})`;
}

/**
 * Writing into a workspace whose objects predate the current schema would mix shapes the rest
 * of the CLI assumes are uniform, so every mutating use case stops here first - and the same
 * goes for a workspace written by a newer PhDude, which this build cannot migrate its way out
 * of. Reads never stop: they warn instead (see application/snapshot.js), so a researcher can
 * still look around.
 * @param {object|null} project
 */
export function assertUpToDate(project) {
  const warning = migrationWarning(project);
  if (!warning) return;
  const hint = isNewerThanRuntime(project) ? 'upgrade phdude' : 'run phdude migrate';
  throw new PhdudeError('USAGE', warning, hint);
}

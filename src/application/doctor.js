import { CURRENT_WORKSPACE_VERSION, workspaceVersionOf } from '../domain/versioning.js';
import { migrationWarning } from './guard.js';
import { listSkills } from './skills.js';

// v0.1 stamps every canonical object at schema version 1 (design spec S5); the migration
// system that makes this per-type is v0.2 (PRD S112).
const SCHEMA_VERSION = 1;

/**
 * Reports what the runtime can and cannot do here. Diagnostic only: never writes.
 * @param {{store: object, git: object, parsers: object[], loadPacks: () => Promise<object[]>,
 *   schemaTypes: string[], node: string, discoverSkills: (roots: object[]) => Promise<object[]>,
 *   skillsDir: string}} deps
 * @returns {Promise<{node: string, pdftotext: boolean, git: boolean, workspace: boolean,
 *   workspaceVersion: number|null, workspaceVersionCurrent: number, parsers: object,
 *   schemaVersions: object, cacheEntries: number, packsAvailable: string[],
 *   skills: object[], warnings: string[]}>}
 */
export async function doctor({
  store,
  git,
  parsers,
  loadPacks,
  schemaTypes,
  node,
  discoverSkills,
  skillsDir,
}) {
  const warnings = [];

  const workspace = await store.exists('phdude.yaml');
  if (!workspace) warnings.push('phdude.yaml not found; run phdude init to create a workspace');

  // doctor is the command a researcher runs when something is off, so a phdude.yaml it cannot
  // read is a warning here, never the exception it is everywhere else.
  let workspaceVersion = null;
  if (workspace) {
    try {
      const project = await store.readProject();
      workspaceVersion = workspaceVersionOf(project);
      const outdated = migrationWarning(project);
      if (outdated) warnings.push(outdated);
    } catch (err) {
      warnings.push(`phdude.yaml could not be read: ${err.message}`);
    }
  }

  const gitAvailable = await git.isAvailable();
  if (!gitAvailable) {
    warnings.push('git is not installed; workspace history and collaboration are unavailable');
  }

  const parserAvailability = {};
  for (const parser of parsers) {
    parserAvailability[parser.name] = await parser.available();
  }
  const pdftotext = parserAvailability.pdf === true;
  if (!pdftotext) {
    warnings.push('pdftotext is not installed; PDF text extraction is unavailable');
  }

  let packsAvailable = [];
  try {
    packsAvailable = (await loadPacks()).map((p) => p.name);
  } catch (err) {
    warnings.push(`packs could not be loaded: ${err.message}`);
  }

  let skills = [];
  try {
    skills = await listSkills({ store, loadPacks, discoverSkills, skillsDir });
  } catch (err) {
    warnings.push(`skills could not be loaded: ${err.message}`);
  }

  return {
    node,
    pdftotext,
    git: gitAvailable,
    workspace,
    workspaceVersion,
    workspaceVersionCurrent: CURRENT_WORKSPACE_VERSION,
    parsers: parserAvailability,
    schemaVersions: Object.fromEntries(schemaTypes.map((t) => [t, SCHEMA_VERSION])),
    cacheEntries: (await store.listCacheEntries()).length,
    packsAvailable,
    skills,
    warnings,
  };
}

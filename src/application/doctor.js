// v0.1 stamps every canonical object at schema version 1 (design spec S5); the migration
// system that makes this per-type is v0.2 (PRD S112).
const SCHEMA_VERSION = 1;

/**
 * Reports what the runtime can and cannot do here. Diagnostic only: never writes.
 * @param {{store: object, git: object, parsers: object[], loadPacks: () => Promise<object[]>,
 *   schemaTypes: string[], node: string}} deps
 * @returns {Promise<{node: string, pdftotext: boolean, git: boolean, workspace: boolean,
 *   parsers: object, schemaVersions: object, cacheEntries: number, packsAvailable: string[],
 *   warnings: string[]}>}
 */
export async function doctor({ store, git, parsers, loadPacks, schemaTypes, node }) {
  const warnings = [];

  const workspace = await store.exists('phdude.yaml');
  if (!workspace) warnings.push('phdude.yaml not found; run phdude init to create a workspace');

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

  return {
    node,
    pdftotext,
    git: gitAvailable,
    workspace,
    parsers: parserAvailability,
    schemaVersions: Object.fromEntries(schemaTypes.map((t) => [t, SCHEMA_VERSION])),
    cacheEntries: (await store.listCacheEntries()).length,
    packsAvailable,
    warnings,
  };
}

import { buildGraph } from '../domain/lineage.js';
import { migrationWarning } from './guard.js';

const TYPES = [
  ['artifact', 'artifacts'],
  ['source', 'sources'],
  ['claim', 'claims'],
  ['evidence', 'evidence'],
  ['fact', 'facts'],
  ['result', 'results'],
  ['question', 'questions'],
  ['hypothesis', 'hypotheses'],
  ['method', 'methods'],
  ['decision', 'decisions'],
];

/**
 * @param {import('../ports/store.js').Store} store
 * @returns {Promise<object>}
 */
export async function loadSnapshot(store) {
  const warnings = [];

  const project = await store.readProject();
  if (project === null) warnings.push('phdude.yaml is missing');
  const outdated = migrationWarning(project);
  if (outdated) warnings.push(outdated);

  const collections = {};
  for (const [type, key] of TYPES) {
    collections[key] = await store.listEntities(type);
  }

  const allObjects = TYPES.flatMap(([, key]) => collections[key]);

  const seenIds = new Set();
  for (const obj of allObjects) {
    if (seenIds.has(obj.id)) warnings.push(`duplicate id: ${obj.id}`);
    seenIds.add(obj.id);
  }

  const graph = buildGraph(allObjects);
  for (const d of graph.dangling) {
    warnings.push(`${d.from} references missing ${d.to}`);
  }

  const events = await store.readEvents(20);

  return {
    project,
    ...collections,
    events,
    graph,
    warnings,
  };
}

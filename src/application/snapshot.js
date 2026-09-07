import { join } from 'node:path';
import { buildGraph } from '../domain/lineage.js';
import { networkAllowed, researchFilters } from '../domain/policy.js';
import { migrationWarning } from './guard.js';

const POLICY_PATH = join('.phdude', 'research-policy.yaml');

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
  ['candidate', 'candidates'],
  ['search', 'searches'],
  ['decision', 'decisions'],
];

/**
 * @param {import('../ports/store.js').Store} store
 * @param {() => string} [clock] - the present, carried on the snapshot so the freshness rules
 *   in `domain/` can read it as data instead of reaching for a clock of their own
 * @returns {Promise<object>}
 */
export async function loadSnapshot(store, clock = () => new Date().toISOString()) {
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
  const policy = await store.readYaml(POLICY_PATH);

  // The manuscript is part of the workspace the reports reason about (spec §3.8): `next` asks
  // which sections are ready to write and which are waiting for approval, `gaps` asks which
  // canonical claim has never reached the prose. Its section bodies are read because a claim
  // can be referenced by a `<!-- claim: -->` marker rather than by the plan.
  const manuscript = await store.readManuscript();
  const sections = manuscript?.sections ?? [];
  const sectionBodies = {};
  for (const entry of sections) {
    if (entry.status === 'planned') continue;
    const text = await store.readSection(entry.file);
    if (text !== null) sectionBodies[entry.id] = text;
  }

  return {
    project,
    ...collections,
    manuscript,
    sectionBodies,
    sectionReports: manuscript === null ? [] : await store.listReports(),
    events,
    graph,
    warnings,
    now: clock(),
    staleAfterDays: researchFilters(policy).staleAfterDays,
    // Whether a search is even runnable here. The reports that recommend one read this so they
    // recommend opening the policy first rather than a command that would refuse.
    networkEnabled: networkAllowed(policy, {}),
  };
}

import { loadSnapshot } from './snapshot.js';
import { detectFactConflicts } from '../domain/conflicts.js';

const KNOWLEDGE_TYPES = [
  ['source', 'sources'],
  ['claim', 'claims'],
  ['evidence', 'evidence'],
  ['fact', 'facts'],
  ['result', 'results'],
  ['question', 'questions'],
  ['hypothesis', 'hypotheses'],
];

function countBy(objs, keyFn) {
  const counts = {};
  for (const o of objs) {
    const k = keyFn(o);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

/**
 * @param {{store: object}} deps
 * @returns {Promise<object>} a StatusReport: project, inventory, knowledge, conflicts,
 *   pendingDecisions, recentEvents, warnings - all derived on read, nothing cached.
 */
export async function status({ store }) {
  const snapshot = await loadSnapshot(store);
  const { project, artifacts, decisions, facts } = snapshot;

  const byType = {};
  for (const [type, key] of KNOWLEDGE_TYPES) {
    const objs = snapshot[key];
    byType[type] = { total: objs.length, byState: countBy(objs, (o) => o.state) };
  }

  return {
    project: project
      ? {
          title: project.title,
          fields: project.fields,
          methods: project.methods,
          outputs: project.outputs,
          mode: project.mode,
        }
      : null,
    inventory: {
      total: artifacts.length,
      byKind: countBy(artifacts, (a) => a.kind),
      byExtraction: countBy(artifacts, (a) => a.extracted?.status),
      unknownRole: artifacts.filter((a) => a.role === 'unknown').length,
    },
    knowledge: { byType },
    conflicts: detectFactConflicts(facts, decisions),
    pendingDecisions: decisions.filter((d) => d.status === 'proposed'),
    recentEvents: snapshot.events.slice(-5),
    warnings: snapshot.warnings,
  };
}

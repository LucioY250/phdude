import { loadSnapshot } from './snapshot.js';
import { detectFactConflicts } from '../domain/conflicts.js';
import { disputedPairs } from '../domain/contradictions.js';
import { questionFreshness } from '../domain/freshness.js';

const KNOWLEDGE_TYPES = [
  ['source', 'sources'],
  ['claim', 'claims'],
  ['evidence', 'evidence'],
  ['fact', 'facts'],
  ['result', 'results'],
  ['question', 'questions'],
  ['hypothesis', 'hypotheses'],
  ['method', 'methods'],
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
 * @param {{store: object, clock?: () => string}} deps
 * @returns {Promise<object>} a StatusReport: project, inventory, knowledge, analysis,
 *   literature, conflicts, pendingDecisions, recentEvents, warnings - all derived on read,
 *   nothing cached.
 */
export async function status({ store, clock }) {
  const snapshot = await loadSnapshot(store, clock);
  const { project, artifacts, decisions, facts, claims } = snapshot;

  const byType = {};
  for (const [type, key] of KNOWLEDGE_TYPES) {
    const objs = snapshot[key];
    byType[type] = { total: objs.length, byState: countBy(objs, (o) => o.state) };
  }

  const freshness = questionFreshness(
    snapshot.questions,
    snapshot.searches,
    snapshot.now,
    snapshot.staleAfterDays,
  );

  // What the workspace computes, as opposed to what it read: the data behind it, the analyses
  // over that data, and the tables and figures those analyses produced. `stale` counts every
  // item `phdude repro check` would not call up to date.
  const analysis = {
    datasets: snapshot.datasets.length,
    analyses: snapshot.analyses.length,
    results: snapshot.results.length,
    tables: snapshot.tables.length,
    figures: snapshot.figures.length,
    reproducible: snapshot.repro.length,
    stale: snapshot.repro.filter((item) => item.status !== 'up-to-date').length,
  };

  const pairs = disputedPairs(claims);
  const claimsById = new Map(claims.map((c) => [c.id, c]));
  const disputedClaims = {};
  for (const claimId of new Set(pairs.flat())) {
    disputedClaims[claimId] = claimsById.get(claimId)?.statement ?? '';
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
    analysis,
    literature: {
      candidates: {
        total: snapshot.candidates.length,
        byState: countBy(snapshot.candidates, (c) => c.state),
      },
      searches: snapshot.searches.length,
      questions: freshness.length,
      staleQuestions: freshness.filter((row) => row.stale).length,
    },
    conflicts: detectFactConflicts(facts, decisions),
    disputedPairs: pairs,
    disputedClaims,
    pendingDecisions: decisions.filter((d) => d.status === 'proposed'),
    recentEvents: snapshot.events.slice(-5),
    warnings: snapshot.warnings,
  };
}

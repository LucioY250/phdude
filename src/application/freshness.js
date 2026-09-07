import { questionFreshness, sourceAges, summary } from '../domain/freshness.js';
import { loadSnapshot } from './snapshot.js';

/**
 * How current the workspace's literature is (spec §3.4): per research question, when it was
 * last searched and whether the policy calls that stale; per source, its age in years; and the
 * counts that summarise both. Read-only - it writes no event and touches no network.
 * @param {{store: object, clock?: () => string}} deps
 * @returns {Promise<{now: string, staleAfterDays: number, questions: object[],
 *   sources: object[], summary: object, warnings: string[]}>}
 */
export async function freshness({ store, clock }) {
  const snapshot = await loadSnapshot(store, clock);
  const questions = questionFreshness(
    snapshot.questions,
    snapshot.searches,
    snapshot.now,
    snapshot.staleAfterDays,
  );
  const sources = sourceAges(snapshot.sources, snapshot.now);

  return {
    now: snapshot.now,
    staleAfterDays: snapshot.staleAfterDays,
    questions,
    sources,
    summary: summary(questions, sources, snapshot.searches),
    warnings: snapshot.warnings,
  };
}

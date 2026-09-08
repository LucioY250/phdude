import { join } from 'node:path';
import { health } from '../domain/health.js';
import { check } from './cite.js';
import { assertUpToDate } from './guard.js';
import { loadSnapshot } from './snapshot.js';

const POLICY_PATH = join('.phdude', 'research-policy.yaml');
const REPORT_PATH = join('reports', 'health.yaml');

// What `--save` leaves behind: enough for the next run's `--trend` and nothing more. The
// observations are recomputed on every run from the workspace itself, so storing them would
// only be storing a second copy of something that can go out of date.
function storedReport(report, at) {
  return {
    schema: 'phdude.health',
    version: 1,
    at,
    overall: report.overall,
    dimensions: report.dimensions.map((d) => ({ key: d.key, score: d.score, weight: d.weight })),
  };
}

function delta(score, previous) {
  return typeof score === 'number' && typeof previous === 'number' ? score - previous : null;
}

function trendAgainst(report, previous) {
  if (previous === null || typeof previous !== 'object') {
    return { at: null, overall: null, dimensions: [] };
  }

  const scores = new Map(
    (previous.dimensions ?? []).map((d) => [d.key, typeof d.score === 'number' ? d.score : null]),
  );

  return {
    at: typeof previous.at === 'string' ? previous.at : null,
    overall: {
      previous: typeof previous.overall === 'number' ? previous.overall : null,
      delta: delta(report.overall, previous.overall),
    },
    dimensions: report.dimensions.map((d) => ({
      key: d.key,
      label: d.label,
      score: d.score,
      previous: scores.get(d.key) ?? null,
      delta: delta(d.score, scores.get(d.key)),
    })),
  };
}

/**
 * The explainable Research Health report (spec §3.3). Read-only unless `save` is set: the score
 * is computed from the workspace every time, and `reports/health.yaml` holds only the last saved
 * one so `--trend` has something to compare against.
 *
 * The `cite check` findings come from the citation registry rather than being re-derived here,
 * so Citation Quality and `phdude cite check` can never disagree about what is wrong.
 *
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {{save?: boolean, trend?: boolean}} [options]
 * @returns {Promise<object>} the report, plus `at`, the path `--save` wrote, and the trend
 */
export async function compute({ store, clock, actor }, { save = false, trend = false } = {}) {
  if (save) assertUpToDate(await store.readProject());

  const snapshot = await loadSnapshot(store, clock);
  const policy = await store.readYaml(POLICY_PATH);
  const citations = await check({ store, snapshot });
  const report = health({ ...snapshot, citations: citations.findings }, policy);

  const previous = save || trend ? await store.readYaml(REPORT_PATH) : null;
  const at = snapshot.now;

  let saved = null;
  if (save) {
    await store.writeYamlAtomic(REPORT_PATH, storedReport(report, at));
    saved = join(store.root, REPORT_PATH);
    await store.appendEvent({
      ts: at,
      op: 'health',
      actor,
      ids: [],
      summary: `health saved: overall ${report.overall === null ? 'n/a' : `${report.overall}/100`}`,
    });
  }

  return { ...report, at, saved, trend: trend ? trendAgainst(report, previous) : null };
}

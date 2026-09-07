import * as research from '../../../application/research.js';
import { renderRows } from './research.js';

function renderFresh(result, candidates) {
  const lines = [
    `${result.reran.length} search(es) re-run, ${result.newCandidates.length} new candidate(s)`,
  ];
  for (const warning of result.warnings) lines.push(`  ${warning} (skipped)`);
  if (result.reran.length === 0) {
    lines.push('', 'Nothing was stale. Pass --all to re-run every recorded search.');
    return lines.join('\n') + '\n';
  }
  // Nothing new is an answer, not an empty list: the same literature came back, so the
  // question is as well covered as it was.
  if (candidates.length === 0) {
    lines.push('', 'The same literature came back; nothing has changed.');
    return lines.join('\n') + '\n';
  }
  return lines.join('\n') + '\n\n' + renderRows(candidates);
}

export default async function researchFreshCommand({ flags, deps }) {
  const result = await research.fresh(
    { store: deps.store, clock: deps.clock, actor: deps.actor, providers: deps.providers },
    { question: flags.question ?? null, all: flags.all, allowNetwork: flags.allowNetwork },
  );

  // Only what this run added: a re-run that finds the same literature again is the answer
  // "nothing has changed", and re-listing the whole registry would bury that.
  const fresh = new Set(result.newCandidates);
  const listed = (await research.list({ store: deps.store })).filter((c) => fresh.has(c.id));

  return { text: renderFresh(result, listed), json: { ...result, results: listed } };
}

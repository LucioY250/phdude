import { stringify } from 'yaml';
import * as research from '../../../application/research.js';
import { PhdudeError } from '../../../domain/errors.js';

const TITLE_WIDTH = 60;

function parseInteger(value, label) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new PhdudeError('VALIDATION', `${label} must be a whole number`, `${label} 2021`);
  }
  return Number(value);
}

function truncate(text) {
  const oneLine = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return oneLine.length > TITLE_WIDTH ? `${oneLine.slice(0, TITLE_WIDTH - 1)}…` : oneLine;
}

function renderRow(candidate) {
  const flag = candidate.needs_approval ? ' [needs approval]' : '';
  return [
    candidate.id.padEnd(16),
    candidate.score.toFixed(3).padStart(6),
    String(candidate.year ?? '-').padEnd(6),
    candidate.state.padEnd(10),
    truncate(candidate.title) + flag,
  ].join(' ');
}

/**
 * @param {object[]} candidates
 * @returns {string} one line per candidate: id, score, year, state and truncated title
 */
export function renderRows(candidates) {
  if (candidates.length === 0) return '(no candidates)\n';
  const lines = candidates.map(renderRow);
  lines.push('', `${candidates.length} candidate(s)`);
  return lines.join('\n') + '\n';
}

function renderSearch(result, candidates) {
  const { search } = result;
  const lastRun = search.runs.filter((run) => run.at === search.last_run);
  const lines = [
    `Search: "${search.query}"${search.question ? ` for ${search.question}` : ''} (${search.id})`,
  ];
  for (const run of lastRun) {
    lines.push(`  ${run.provider}: ${run.count} result(s), ${run.new} new`);
  }
  for (const warning of result.warnings) lines.push(`  ${warning} (skipped)`);
  lines.push(
    '',
    `${result.candidates.created.length} new candidate(s), ${result.candidates.existing.length} already recorded`,
  );
  return lines.join('\n') + '\n\n' + renderRows(candidates);
}

export default async function researchCommand({ sub, positionals, flags, deps }) {
  const storeDeps = { store: deps.store };

  if (sub === 'list') {
    const rows = await research.list(storeDeps, {
      state: flags.state,
      question: flags.question,
    });
    return { text: renderRows(rows), json: rows };
  }

  if (sub === 'accept') {
    const id = positionals[2];
    if (!id) {
      throw new PhdudeError(
        'USAGE',
        'research accept needs a candidate id',
        'phdude research accept <CAND-id> [--type article] [--approve-preprint]',
      );
    }
    const result = await research.accept(
      { store: deps.store, clock: deps.clock, actor: deps.actor },
      id,
      { type: flags.type, approvePreprint: flags.approvePreprint },
    );
    const text = result.created
      ? `Accepted ${result.candidate.id} as ${result.source.id}\n`
      : `Accepted ${result.candidate.id}; ${result.source.id} was already recorded\n`;
    return { text, json: result };
  }

  if (sub === 'dismiss') {
    const id = positionals[2];
    if (!id) {
      throw new PhdudeError(
        'USAGE',
        'research dismiss needs a candidate id',
        'phdude research dismiss <CAND-id> --reason "…"',
      );
    }
    const dismissed = await research.dismiss(
      { store: deps.store, clock: deps.clock, actor: deps.actor },
      id,
      { reason: flags.reason },
    );
    return { text: `Dismissed ${dismissed.id}: ${dismissed.reason}\n`, json: dismissed };
  }

  if (sub === 'show') {
    const id = positionals[2];
    if (!id) {
      throw new PhdudeError('USAGE', 'research show needs an id', 'phdude research show <CAND-id>');
    }
    const obj = await research.show(storeDeps, id);
    return { text: stringify(obj, { lineWidth: 0 }), json: obj };
  }

  const query = positionals.slice(1).join(' ');
  if (!query) {
    throw new PhdudeError(
      'USAGE',
      'research needs a query',
      'phdude research "<query>" [--question RQ-n]',
    );
  }

  const result = await research.search(
    {
      store: deps.store,
      clock: deps.clock,
      actor: deps.actor,
      providers: deps.providers,
    },
    {
      query,
      question: flags.question ?? null,
      providers: flags.provider,
      from: parseInteger(flags.from, '--from'),
      limit: parseInteger(flags.limit, '--limit'),
      allowNetwork: flags.allowNetwork,
    },
  );

  // Only the candidates this run produced, so a researcher reviewing a fresh search is not
  // handed the whole registry again.
  const ids = new Set([...result.candidates.created, ...result.candidates.existing]);
  const listed = (await research.list(storeDeps)).filter((c) => ids.has(c.id));

  // `results` carries the full candidate objects, so `--json` shows the `score_parts` behind
  // the ranking rather than just the ids (spec §3.3).
  return { text: renderSearch(result, listed), json: { ...result, results: listed } };
}

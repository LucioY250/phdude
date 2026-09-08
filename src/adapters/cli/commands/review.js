import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import * as review from '../../../application/review.js';
import { PhdudeError } from '../../../domain/errors.js';

const MESSAGE_WIDTH = 58;

function truncate(text) {
  const oneLine = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return oneLine.length > MESSAGE_WIDTH ? `${oneLine.slice(0, MESSAGE_WIDTH - 1)}…` : oneLine;
}

function renderRows(reviews) {
  if (reviews.length === 0) return '(no review findings)\n';
  const lines = reviews.map((item) =>
    [
      item.id.padEnd(18),
      item.severity.padEnd(6),
      item.status.padEnd(10),
      item.kind.padEnd(16),
      item.target.padEnd(20),
      truncate(item.message),
    ].join(' '),
  );
  lines.push('', `${reviews.length} finding(s)`);
  return lines.join('\n') + '\n';
}

function renderContext(result) {
  const lines = [
    `Review context: ${result.kind} on ${result.target.id} (${result.target.kind})`,
    `  ${result.path}`,
    `  ${result.included.length} block(s) within ${result.budget} characters`,
  ];
  if (result.truncated.length > 0) {
    lines.push(`  left out: ${result.truncated.map((item) => item.kind).join(', ')}`);
  }
  lines.push('', 'What to send back:');
  for (const line of result.contract) lines.push(`  - ${line}`);
  return lines.join('\n') + '\n';
}

function renderSubmit(result) {
  const lines = [
    `Recorded ${result.created.length} finding(s) as ${result.kind} reviews (mode ${result.mode})`,
  ];
  for (const item of result.created) {
    lines.push(
      `  ${item.id} ${item.severity.padEnd(6)} ${item.target} — ${truncate(item.message)}`,
    );
  }
  if (result.existing.length > 0) {
    lines.push(`  ${result.existing.length} finding(s) were already recorded, and are unchanged`);
  }
  if (result.created.length === 0 && result.existing.length === 0) {
    lines.push('  the reviewer found nothing to report');
  }
  return lines.join('\n') + '\n';
}

function requireId(positionals, sub) {
  const id = positionals[2];
  if (!id) {
    throw new PhdudeError(
      'USAGE',
      `review ${sub} needs a review id`,
      `phdude review ${sub} <REVIEW-id>`,
    );
  }
  return id;
}

const TRANSITIONS = { accept: review.accept, dismiss: review.dismiss, resolve: review.resolve };

export default async function reviewCommand({ sub, positionals, flags, deps, cwd }) {
  const storeDeps = { store: deps.store };
  const writeDeps = { store: deps.store, clock: deps.clock, actor: deps.actor };

  if (sub === 'list') {
    const rows = await review.list(storeDeps, { status: flags.status, kind: flags.kind });
    return { text: renderRows(rows), json: rows };
  }

  if (sub === 'show') {
    const obj = await review.show(storeDeps, requireId(positionals, 'show'));
    return { text: stringify(obj, { lineWidth: 0 }), json: obj };
  }

  if (sub === 'submit') {
    const result = await review.submit(
      {
        ...writeDeps,
        // The findings file is one the reviewer just wrote next to its own working directory,
        // not a workspace object, so it is read relative to the shell's cwd.
        readText: async (path) => {
          try {
            return await readFile(resolve(cwd, path), 'utf8');
          } catch (err) {
            if (err.code === 'ENOENT' || err.code === 'EISDIR') return null;
            throw err;
          }
        },
      },
      { file: flags.file, kind: flags.kind },
    );
    return { text: renderSubmit(result), json: result };
  }

  const transition = TRANSITIONS[sub];
  if (transition) {
    const id = requireId(positionals, sub);
    const result = await transition(writeDeps, id, { reason: flags.reason });
    const text = result.changed
      ? `${id} is now ${result.review.status}\n`
      : `${id} is already ${result.review.status}\n`;
    return { text, json: result };
  }

  const kind = sub ?? positionals[1];
  if (!kind) {
    throw new PhdudeError(
      'USAGE',
      'review needs a kind, or one of list|show|submit|accept|dismiss|resolve',
      'phdude review methodology [--target <id|manuscript:<section>|project>]',
    );
  }

  const result = await review.context(
    { store: deps.store, clock: deps.clock },
    { kind, target: flags.target, budget: flags.budget },
  );
  return { text: renderContext(result), json: result };
}

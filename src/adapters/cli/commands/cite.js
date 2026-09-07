import * as cite from '../../../application/cite.js';
import { PhdudeError } from '../../../domain/errors.js';

function renderList(rows) {
  if (rows.length === 0) return '(no sources)\n';
  const lines = rows.map(
    (r) =>
      `${r.bibkey.padEnd(24)} ${String(r.year ?? '-').padEnd(6)} ${r.id.padEnd(14)} cited_by=${r.cited_by}  ${r.title}`,
  );
  lines.push('', `${rows.length} source(s)`);
  return lines.join('\n') + '\n';
}

function renderFinding(f) {
  const hint = f.hint ? ` — ${f.hint}` : '';
  return `  [${f.kind}] ${f.id}: ${f.message}${hint}`;
}

function renderCheck(report) {
  const blocking = report.findings.filter((f) => f.kind !== 'uncited-source');
  const informational = report.findings.filter((f) => f.kind === 'uncited-source');

  const lines = [report.ok ? 'OK' : `FAILED: ${blocking.length} finding(s)`];
  for (const f of blocking) lines.push(renderFinding(f));

  if (informational.length > 0) {
    lines.push('', `Informational (does not fail the check):`);
    for (const f of informational) lines.push(renderFinding(f));
  }

  return lines.join('\n') + '\n';
}

export default async function citeCommand({ sub, flags, deps }) {
  const storeDeps = { store: deps.store };

  if (sub === 'list' || sub === undefined || sub === null) {
    const rows = await cite.list(storeDeps);
    return { text: renderList(rows), json: rows };
  }

  if (sub === 'check') {
    const report = await cite.check(storeDeps);
    return { text: renderCheck(report), json: report, exitCode: report.ok ? 0 : 2 };
  }

  if (sub === 'export') {
    const result = await cite.exportRegistry({ store: deps.store, format: flags.format });
    return { text: `Wrote ${result.path} (${result.count} source(s))\n`, json: result };
  }

  throw new PhdudeError(
    'USAGE',
    `unknown cite sub-command: ${sub}`,
    'valid sub-commands: list, check, export',
  );
}

import { stringify } from 'yaml';
import * as profile from '../../../application/profile.js';
import { PhdudeError } from '../../../domain/errors.js';

const SEVERITY_ORDER = ['block', 'warn', 'info'];

function renderList(venues) {
  if (venues.length === 0) return '(no venue profiles found)\n';
  const width = Math.max(...venues.map((venue) => venue.name.length));
  const lines = venues.map((venue) => {
    const mark = venue.applied ? '[x]' : '[ ]';
    const active = venue.active ? '  (target)' : '';
    return `${mark} ${venue.name.padEnd(width)}  ${venue.display} — ${venue.document_class}, ${venue.sections} sections${active}`;
  });
  lines.push('', 'phdude packs apply <venue> adopts one; phdude profile use <venue> targets it.');
  return lines.join('\n') + '\n';
}

// The resolved paths are absolute and depend on where PhDude is installed, so the human view
// leaves them out; --json keeps them, because that is what a build reads.
const RESOLVED_KEYS = ['dir', 'cslPath', 'templatePaths'];

function renderShow(found) {
  const shown = Object.fromEntries(
    Object.entries(found).filter(([key]) => !RESOLVED_KEYS.includes(key)),
  );
  return stringify(shown, { lineWidth: 0 });
}

function renderFinding(finding) {
  const where = finding.section ? ` ${finding.section}:` : '';
  const hint = finding.hint ? `\n         ${finding.hint}` : '';
  return `  ${finding.severity.padEnd(5)}${where} ${finding.message}${hint}`;
}

function renderCheck(report) {
  const lines = [`${report.profile} (${report.display})`];
  for (const severity of SEVERITY_ORDER) {
    for (const finding of report.findings.filter((f) => f.severity === severity)) {
      lines.push(renderFinding(finding));
    }
  }
  if (report.findings.length === 0) lines.push('  (nothing to report)');
  lines.push(
    '',
    `${report.counts.block} block, ${report.counts.warn} warn, ${report.counts.info} info`,
  );
  return lines.join('\n') + '\n';
}

export default async function profileCommand({ sub, positionals, flags, deps }) {
  const readDeps = { store: deps.store, loadProfile: deps.loadProfile };

  if (sub === 'list' || sub === undefined || sub === null) {
    const venues = await profile.list({ store: deps.store, loadProfiles: deps.loadProfiles });
    return { text: renderList(venues), json: venues };
  }

  if (sub === 'show') {
    const found = await profile.show(readDeps, { profile: flags.profile });
    return { text: renderShow(found), json: found };
  }

  if (sub === 'check') {
    const report = await profile.check(readDeps, { profile: flags.profile });
    return { text: renderCheck(report), json: report, exitCode: report.blocked ? 2 : 0 };
  }

  if (sub === 'use') {
    const name = positionals[2] ?? flags.profile;
    const result = await profile.use(
      { store: deps.store, clock: deps.clock, actor: deps.actor, loadProfile: deps.loadProfile },
      name,
    );
    const text = result.changed
      ? `The manuscript now targets ${result.profile}\n`
      : `The manuscript already targets ${result.profile}\n`;
    return { text, json: result };
  }

  throw new PhdudeError(
    'USAGE',
    `unknown profile sub-command: ${sub}`,
    'valid sub-commands: list, show, check, use',
  );
}

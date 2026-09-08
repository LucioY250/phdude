import * as audit from '../../../application/audit.js';
import { PhdudeError } from '../../../domain/errors.js';

const MESSAGE_WIDTH = 58;

const TARGETS = ['citations'];

function truncate(text) {
  const oneLine = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return oneLine.length > MESSAGE_WIDTH ? `${oneLine.slice(0, MESSAGE_WIDTH - 1)}…` : oneLine;
}

function renderRow(item) {
  return `  ${item.id} ${item.severity.padEnd(6)} ${item.target.padEnd(22)} ${truncate(item.message)}`;
}

function renderCitations(result) {
  const scope = result.network
    ? `${result.sources} source(s), ${result.checked} DOI(s) verified at Crossref`
    : `${result.sources} source(s), offline only`;
  const lines = [`Citation audit: ${scope}`, ''];

  if (result.created.length === 0) {
    lines.push('No new finding.');
  } else {
    lines.push(`${result.created.length} new finding(s):`);
    for (const item of result.created) lines.push(renderRow(item));
  }

  if (result.existing.length > 0) {
    lines.push('', `${result.existing.length} finding(s) were already recorded, and are unchanged`);
  }
  for (const warning of result.warnings) lines.push(`  ${warning} (not checked)`);

  if (result.created.length > 0) {
    lines.push('', 'Rule on each with phdude review accept|dismiss <REVIEW-id>');
  }
  return lines.join('\n') + '\n';
}

export default async function auditCommand({ sub, flags, deps }) {
  if (sub !== 'citations') {
    throw new PhdudeError(
      'USAGE',
      `unknown audit target: ${sub ?? '(none)'}`,
      `phdude audit ${TARGETS.join('|')} [--allow-network]`,
    );
  }

  const result = await audit.citations(
    { store: deps.store, clock: deps.clock, actor: deps.actor, lookupDoi: deps.lookupDoi },
    { allowNetwork: flags.allowNetwork },
  );
  return { text: renderCitations(result), json: result };
}

const IMPACT_LABEL = { high: 'HIGH', medium: 'MEDIUM', low: 'LOW' };

function renderCounts(counts) {
  const keys = Object.keys(counts).sort();
  return keys.length ? keys.map((k) => `${k}=${counts[k]}`).join(', ') : '(none)';
}

function renderProject(project) {
  if (!project) return ['Project: (phdude.yaml is missing)'];
  return [
    `Project: ${project.title}`,
    `Fields: ${project.fields.length ? project.fields.join(', ') : '(none)'}`,
    `Methods: ${project.methods.length ? project.methods.join(', ') : '(none)'}`,
    `Outputs: ${project.outputs.length ? project.outputs.join(', ') : '(none)'}`,
    `Mode: ${project.mode}`,
  ];
}

function renderConflictLine(c) {
  const values = c.values
    .map((v) => `${v.value}${v.unit ? ' ' + v.unit : ''} (${v.factId} from ${v.from.artifact})`)
    .join(' vs ');
  const status = c.resolved ? `resolved by ${c.resolved.decision}` : 'open';
  return `  - ${c.key}: ${values} [${status}]`;
}

function truncate(text, max = 60) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function renderDisputedLine([a, b], disputedClaims) {
  const statementA = truncate(disputedClaims[a] ?? '');
  const statementB = truncate(disputedClaims[b] ?? '');
  return `  - ${a} ⟷ ${b}: "${statementA}" vs "${statementB}"`;
}

/**
 * @param {object} report - a StatusReport, see application/status.js
 * @returns {string} plain-text, deterministic rendering (no timestamps besides event op/summary)
 */
export function renderStatus(report) {
  const lines = [...renderProject(report.project), ''];

  lines.push('Inventory:');
  lines.push(`  Total artifacts: ${report.inventory.total}`);
  lines.push(`  By kind: ${renderCounts(report.inventory.byKind)}`);
  lines.push(`  By extraction: ${renderCounts(report.inventory.byExtraction)}`);
  lines.push(`  Unknown role: ${report.inventory.unknownRole}`);
  lines.push('');

  lines.push('Knowledge:');
  for (const [type, { total, byState }] of Object.entries(report.knowledge.byType)) {
    lines.push(`  ${type}: total=${total} (${renderCounts(byState)})`);
  }
  lines.push('');

  const openCount = report.conflicts.filter((c) => c.resolved === null).length;
  lines.push(`Conflicts (${openCount} open of ${report.conflicts.length} total):`);
  if (report.conflicts.length === 0) {
    lines.push('  (none)');
  } else {
    for (const c of report.conflicts) lines.push(renderConflictLine(c));
  }
  lines.push('');

  lines.push(`Disputed claims (${report.disputedPairs.length} pairs):`);
  if (report.disputedPairs.length === 0) {
    lines.push('  (none)');
  } else {
    for (const pair of report.disputedPairs) {
      lines.push(renderDisputedLine(pair, report.disputedClaims));
    }
  }
  lines.push('');

  lines.push(`Pending decisions (${report.pendingDecisions.length}):`);
  if (report.pendingDecisions.length === 0) {
    lines.push('  (none)');
  } else {
    for (const d of report.pendingDecisions) lines.push(`  - ${d.id}: ${d.title}`);
  }
  lines.push('');

  lines.push('Recent events:');
  if (report.recentEvents.length === 0) {
    lines.push('  (none)');
  } else {
    for (const e of report.recentEvents) lines.push(`  ${e.op}: ${e.summary}`);
  }

  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * @param {{actions: object[], top: object}} result - see application/next.js
 * @returns {string} plain-text rendering matching PRD §45
 */
export function renderNext(result) {
  const { top, actions } = result;
  const rest = actions.slice(1);

  const lines = [
    'Highest-impact next action:',
    '',
    top.action,
    '',
    'Why:',
    ...top.why.map((w) => `- ${w}`),
    '',
    'Expected impact:',
    IMPACT_LABEL[top.impact],
    '',
    'Command:',
    top.command || '(none)',
    '',
    'Other candidates:',
  ];

  if (rest.length === 0) {
    lines.push('  (none)');
  } else {
    rest.forEach((a, i) => lines.push(`${i + 1}. (${a.impact}) ${a.action}`));
  }

  return lines.join('\n') + '\n';
}

/**
 * @param {object} obj
 * @returns {string}
 */
export function printJson(obj) {
  return JSON.stringify(obj, null, 2);
}

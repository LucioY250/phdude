import { toCsv } from '../../application/ingest.js';

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

  const analysis = report.analysis;
  lines.push('Analysis:');
  lines.push(`  Datasets: ${analysis.datasets}`);
  lines.push(`  Analyses: ${analysis.analyses}`);
  lines.push(`  Results (from analyses): ${analysis.results}`);
  lines.push(`  Tables: ${analysis.tables}`);
  lines.push(`  Figures: ${analysis.figures}`);
  lines.push(`  Stale or unbuilt: ${analysis.stale} of ${analysis.reproducible}`);
  lines.push('');

  const lit = report.literature;
  lines.push('Literature:');
  lines.push(
    `  Candidates: total=${lit.candidates.total} (${renderCounts(lit.candidates.byState)})`,
  );
  lines.push(`  Searches: ${lit.searches}`);
  lines.push(
    `  Questions with a stale or missing search: ${lit.staleQuestions} of ${lit.questions}`,
  );
  lines.push('');

  const openCount = report.conflicts.filter((c) => c.resolved === null).length;
  lines.push(`Conflicts (${openCount} open of ${report.conflicts.length} total):`);
  if (report.conflicts.length === 0) {
    lines.push('  (none)');
  } else {
    for (const c of report.conflicts) lines.push(renderConflictLine(c));
  }
  lines.push('');

  const pairWord = report.disputedPairs.length === 1 ? 'pair' : 'pairs';
  lines.push(`Disputed claims (${report.disputedPairs.length} ${pairWord}):`);
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

const MATRIX_HEADER = [
  'Bibkey',
  'Year',
  'Type',
  'Questions',
  'Claims',
  'Strongest evidence',
  'Facts',
  'Methods',
];

function matrixCell(value) {
  if (value === null || value === undefined) return '-';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '-';
  return String(value);
}

function matrixRowValues(row) {
  return [
    row.bibkey,
    row.year,
    row.type,
    row.questions,
    row.claims,
    row.strongestEvidence,
    row.facts,
    row.methods,
  ].map(matrixCell);
}

function mdEscapeCell(value) {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderMatrixMd(rows) {
  const lines = [
    `| ${MATRIX_HEADER.join(' | ')} |`,
    `| ${MATRIX_HEADER.map(() => '---').join(' | ')} |`,
  ];
  for (const row of rows) {
    lines.push(`| ${matrixRowValues(row).map(mdEscapeCell).join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}

function renderMatrixCsv(rows) {
  return toCsv([MATRIX_HEADER, ...rows.map(matrixRowValues)]);
}

/**
 * @param {object[]} rows - matrix rows, see application/matrix.js
 * @param {'md'|'csv'} format
 * @returns {string}
 */
export function renderMatrix(rows, format) {
  if (format === 'csv') return renderMatrixCsv(rows);
  return renderMatrixMd(rows);
}

const GAP_SEVERITIES = ['high', 'medium', 'low'];

/**
 * @param {{gaps: object[], counts: {high: number, medium: number, low: number}}} report - see
 *   application/gaps.js
 * @returns {string}
 */
export function renderGaps(report) {
  const { gaps, counts } = report;
  if (gaps.length === 0) return 'No gaps found.\n';

  const lines = [];
  for (const severity of GAP_SEVERITIES) {
    const group = gaps.filter((g) => g.severity === severity);
    lines.push(`${severity.toUpperCase()} (${counts[severity] ?? 0}):`);
    if (group.length === 0) {
      lines.push('  (none)');
    } else {
      for (const g of group) {
        lines.push(`  - [${g.kind}] ${g.id}`);
        lines.push(`    Why: ${g.why}`);
        lines.push(`    Command: ${g.command}`);
      }
    }
    lines.push('');
  }
  lines.pop();

  return lines.join('\n') + '\n';
}

// What each reason means, in the researcher's terms. The domain names the kind; the wording of
// it is the CLI's, exactly as `figure check` renders its own findings.
const REASON_TEXT = {
  'missing-alt': () => 'no alt text; a figure without one cannot be published (PRD §100)',
  'never-run': () => 'no successful run recorded',
  'missing-output': (r) => `output missing: ${r.path}`,
  'missing-input': (r) => `input gone: ${r.input}`,
  'stale-input': (r) => `input ${r.input} changed since the last run`,
  'unregistered-input': (r) => `input ${r.input} bytes changed on disk`,
  'upstream-stale': (r) => `input ${r.input} comes from ${r.analysis}, which is ${r.status}`,
};

const REPRO_STATUSES = ['up-to-date', 'stale', 'never-run', 'missing-output'];

/**
 * @param {{items: object[], counts: Record<string, number>, attention: number}} report
 * @returns {string} plain-text rendering of `phdude repro check`
 */
export function renderRepro(report) {
  const { items, counts } = report;
  if (items.length === 0) return 'No analyses, tables or figures are declared.\n';

  const idWidth = Math.max(...items.map((i) => i.id.length));
  const nameWidth = Math.max(...items.map((i) => String(i.name ?? '').length));
  const lines = [];
  for (const item of items) {
    lines.push(
      `${item.id.padEnd(idWidth)}  ${String(item.name ?? '').padEnd(nameWidth)}  ${item.status}`,
    );
    for (const reason of item.reasons) lines.push(`  - ${REASON_TEXT[reason.kind](reason)}`);
  }

  const tally = REPRO_STATUSES.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${s}`);
  lines.push('', `${items.length} item(s): ${tally.join(', ')}`);
  return lines.join('\n') + '\n';
}

function renderQuestionRow(row) {
  const age =
    row.lastSearch === null
      ? 'never searched'
      : `last searched ${row.lastSearch.slice(0, 10)} (${row.daysAgo} day(s) ago)`;
  return `  ${row.question.padEnd(8)} ${age}${row.stale ? '  [stale]' : ''}`;
}

function renderSourceRow(row) {
  const age = row.age === null ? 'no year recorded' : `${row.year} (${row.age} year(s) old)`;
  return `  ${row.id.padEnd(16)} ${age}`;
}

/**
 * @param {object} report - a freshness report, see application/freshness.js
 * @returns {string}
 */
export function renderFreshness(report) {
  const { questions, sources, summary } = report;
  const lines = [
    `Questions (${summary.questions}): ${summary.stale} stale, ${summary.neverSearched} never searched`,
  ];
  if (questions.length === 0) lines.push('  (none)');
  else lines.push(...questions.map(renderQuestionRow));

  const ages =
    summary.medianAge === null
      ? 'no source records a year'
      : `median age ${summary.medianAge} year(s), oldest ${summary.oldest} year(s)`;
  lines.push('', `Sources (${summary.sources}): ${ages}`);
  if (sources.length === 0) lines.push('  (none recorded)');
  else lines.push(...sources.map(renderSourceRow));

  lines.push(
    '',
    `Searches recorded: ${summary.searches}; a search is stale after ${report.staleAfterDays} day(s).`,
  );

  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }

  return lines.join('\n') + '\n';
}

const PROSE_SCORES = [
  ['specificity', 'Specificity'],
  ['evidenceAlignment', 'Evidence Alignment'],
  ['epistemicPrecision', 'Epistemic Precision'],
  ['structuralVariation', 'Structural Variation'],
  ['authorVoice', 'Author Voice'],
  ['conciseness', 'Conciseness'],
];

const PROSE_SEVERITIES = ['block', 'warn', 'info'];

// Three of the six sub-scores are computed against the evidence graph and the voice profile
// (PRD §39.1), which a bare text file does not carry. Saying so beats printing a bare `n/a`,
// and beats inventing a number from the prose alone.
const NEEDS_CONTEXT = 'n/a (needs manuscript context)';

/**
 * @param {object} report - an Academic Prose Quality report, see application/prose.js
 * @returns {string}
 */
export function renderProse(report) {
  const aggregate = report.aggregate === null ? 'n/a' : `${report.aggregate}/100`;
  const lines = [`Academic Prose Quality: ${aggregate}`, ''];

  for (const [key, label] of PROSE_SCORES) {
    const score = report.scores[key];
    lines.push(`${label.padEnd(24)}${score === null ? NEEDS_CONTEXT : score}`);
  }

  const voice = report.voice ?? [];
  if (voice.length > 0) {
    lines.push('', `Voice (${voice.length}):`);
    for (const finding of voice) {
      lines.push(`  - ${finding.message}`);
      if (finding.hint) lines.push(`    Hint: ${finding.hint}`);
    }
  }

  lines.push('', `Observations (${report.observations.length}):`);
  if (report.observations.length === 0) {
    lines.push('  (none)');
    return lines.join('\n') + '\n';
  }

  for (const severity of PROSE_SEVERITIES) {
    const group = report.observations.filter((o) => o.severity === severity);
    if (group.length === 0) continue;
    lines.push('', `${severity.toUpperCase()} (${group.length}):`);
    for (const o of group) {
      lines.push(o.excerpt === '' ? `  - ${o.line}: ${o.message}` : `  - ${o.line}: ${o.excerpt}`);
      if (o.excerpt !== '') lines.push(`    ${o.rule}: ${o.message}`);
      if (o.hint) lines.push(`    Hint: ${o.hint}`);
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * The writing context report of `phdude write`: where the context is, what went into it, what
 * did not fit, and the contract the draft has to meet (spec §3.3).
 * @param {object} result - see application/write.js
 * @returns {string}
 */
export function renderWriteContext(result) {
  const lines = [
    `Writing context for ${result.section.id} (${result.section.status}): ${result.path}`,
    '',
    `Budget: ${result.budget} characters, ${result.included.reduce((sum, item) => sum + item.chars, 0)} used`,
    `Voice: ${result.voice.id}${result.voice.found ? '' : ' (no profile recorded; writing plainly)'}`,
    '',
    `Included (${result.included.length}):`,
  ];
  for (const item of result.included) {
    lines.push(`  ${item.kind.padEnd(12)} ${item.id.padEnd(18)} ${item.chars} chars`);
  }
  if (result.truncated.length > 0) {
    lines.push('', `Left out for budget (${result.truncated.length}):`);
    for (const item of result.truncated) lines.push(`  ${item.kind.padEnd(12)} ${item.id}`);
  }
  lines.push('', 'Draft contract:');
  for (const rule of result.contract) lines.push(`  - ${rule}`);
  return lines.join('\n') + '\n';
}

/**
 * The revision contract of `phdude deslop <section>` with no file: what the prose is doing now,
 * and what a revision may and may not change (spec §3.5).
 * @param {object} result - see application/deslop.js
 * @returns {string}
 */
export function renderDeslop(result) {
  const lines = [`Revision contract for ${result.section.id} (${result.section.status})`, ''];
  lines.push(renderProse({ ...result, observations: result.observations }).trimEnd(), '');
  lines.push('Change:');
  for (const rule of result.contract.change) lines.push(`  - ${rule}`);
  lines.push('', 'Preserve exactly (the meaning gate blocks a revision that loses one):');
  for (const rule of result.contract.preserve) lines.push(`  - ${rule}`);
  lines.push(
    '',
    `Submit the revision with: phdude deslop ${result.section.id} --file <revised.md>`,
  );
  return lines.join('\n') + '\n';
}

/**
 * @param {object} obj
 * @returns {string}
 */
export function printJson(obj) {
  return JSON.stringify(obj, null, 2);
}

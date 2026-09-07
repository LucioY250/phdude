import { buildGraph } from './lineage.js';
import { openConflicts } from './conflicts.js';
import { findGaps } from './gaps.js';

const IMPACT_RANK = { high: 0, medium: 1, low: 2 };
const CANDIDATE_BACKLOG_THRESHOLD = 5;
const COLLECTION_KEYS = [
  'artifacts',
  'sources',
  'claims',
  'evidence',
  'facts',
  'results',
  'questions',
  'hypotheses',
  'decisions',
];

function allObjects(snapshot) {
  return COLLECTION_KEYS.flatMap((k) => snapshot[k] ?? []);
}

function getGraph(snapshot) {
  return snapshot.graph ?? buildGraph(allObjects(snapshot));
}

function ruleNoQuestions(snapshot) {
  if ((snapshot.questions ?? []).length > 0) return null;
  return {
    rule: 'no-questions',
    action: 'Define the research question(s)',
    why: ['0 research questions have been defined'],
    impact: 'high',
    command: `phdude add question --json '{"text":"…"}'`,
    dependents: 0,
  };
}

function ruleExtractionUnavailable(snapshot) {
  const bad = (snapshot.artifacts ?? []).filter((a) => a.extracted?.status !== 'ok');
  if (bad.length === 0) return null;

  const shown = bad.slice(0, 3).map((a) => `${a.id} (${a.path})`);
  const why = [
    `${bad.length} artifact(s) without usable text (status: partial/unavailable/failed): ${shown.join(', ')}`,
  ];
  const hints = [...new Set(bad.map((a) => a.extracted?.warnings?.[0]).filter(Boolean))].slice(
    0,
    3,
  );
  why.push(...hints);

  return {
    rule: 'extraction-unavailable',
    action: 'Fix document extraction for unreadable artifacts',
    why,
    impact: 'high',
    command: 'phdude doctor',
    dependents: bad.length,
  };
}

function ruleUnknownRoles(snapshot) {
  const unknown = (snapshot.artifacts ?? []).filter((a) => a.role === 'unknown');
  if (unknown.length === 0) return null;
  return {
    rule: 'unknown-roles',
    action: 'Classify artifacts with unknown role',
    why: [`${unknown.length} artifact(s) have role "unknown"`],
    impact: 'medium',
    command: 'phdude bootstrap',
    dependents: unknown.length,
  };
}

function distinctValuesText(conflict) {
  const groups = new Map();
  for (const v of conflict.values) {
    const label = `${v.value}${v.unit ? ' ' + v.unit : ''}`;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(v.from.artifact);
  }
  return [...groups.entries()].map(([label, arts]) => `${label} (${arts.join(', ')})`).join(' vs ');
}

function ruleOpenConflicts(snapshot, conflicts) {
  const open = openConflicts(conflicts ?? []);
  if (open.length === 0) return null;

  const graph = getGraph(snapshot);
  const conflictArtifacts = new Set();
  for (const c of open) for (const v of c.values) conflictArtifacts.add(v.from.artifact);

  const citingEvidence = new Set(
    graph.edges.filter((e) => e.rel === 'cites' && conflictArtifacts.has(e.to)).map((e) => e.from),
  );
  const dependentClaims = new Set(
    graph.edges
      .filter((e) => e.rel === 'supported_by' && citingEvidence.has(e.to))
      .map((e) => e.from),
  );

  const why = open.map((c) => `${c.key}: ${distinctValuesText(c)}`);
  why.push(`${dependentClaims.size} claim(s) depend on the conflicting artifacts`);
  const primary = open[0];
  const factIds = primary.values.map((v) => v.factId);

  return {
    rule: 'open-conflicts',
    action: `Resolve the conflicting value(s) for "${primary.key}"`,
    why,
    impact: 'high',
    command:
      `phdude decide propose --title "Resolve ${primary.key}" --rationale "…" ` +
      `--affects ${factIds.join(' ')} --change '{"fact_key":"${primary.key}","canonical_value":…}'`,
    dependents: dependentClaims.size,
  };
}

function ruleUnsupportedClaims(snapshot) {
  const unsupported = (snapshot.claims ?? []).filter(
    (c) => ['canonical', 'supported'].includes(c.state) && (c.supported_by?.length ?? 0) === 0,
  );
  if (unsupported.length === 0) return null;

  const shown = unsupported.slice(0, 3).map((c) => c.id);
  return {
    rule: 'unsupported-claims',
    action: 'Attach evidence to unsupported claims',
    why: [
      `${unsupported.length} claim(s) marked canonical/supported have no evidence: ${shown.join(', ')}`,
    ],
    impact: 'high',
    command: `phdude link ${unsupported[0].id} --to <EVID-id>`,
    dependents: unsupported.length,
  };
}

function ruleCandidateBacklog(snapshot) {
  const candidates = (snapshot.claims ?? []).filter((c) => c.state === 'candidate');
  if (candidates.length < CANDIDATE_BACKLOG_THRESHOLD) return null;
  return {
    rule: 'candidate-backlog',
    action: 'Review the candidate-claims backlog',
    why: [`${candidates.length} candidate claims are awaiting review`],
    impact: 'medium',
    command: 'phdude knowledge list --type claim --state candidate',
    dependents: candidates.length,
  };
}

function rulePacksRecommended(snapshot) {
  const project = snapshot.project;
  const recommended = project?.packs_recommended ?? [];
  const applied = new Set([...(project?.fields ?? []), ...(project?.methods ?? [])]);
  const pending = [...recommended].filter((name) => !applied.has(name)).sort();
  if (pending.length === 0) return null;
  return {
    rule: 'packs-recommended',
    action: 'Apply recommended packs',
    why: [`${pending.length} recommended pack(s) are not yet applied: ${pending.join(', ')}`],
    impact: 'medium',
    command: `phdude packs apply ${pending[0]}`,
    dependents: pending.length,
  };
}

function rulePendingDecisions(snapshot) {
  const pending = (snapshot.decisions ?? [])
    .filter((d) => d.status === 'proposed')
    .sort((a, b) => a.id.localeCompare(b.id));
  if (pending.length === 0) return null;
  return {
    rule: 'pending-decisions',
    action: 'Approve or reject pending decisions',
    why: [
      `${pending.length} decision(s) are awaiting approval: ${pending.map((d) => d.id).join(', ')}`,
    ],
    impact: 'medium',
    command: `phdude decide approve ${pending[0].id} --by <you>`,
    dependents: pending.length,
  };
}

function ruleQuestionGaps(snapshot) {
  const questions = snapshot.questions ?? [];
  if (questions.length === 0) return null;

  const graph = getGraph(snapshot);
  const claimIds = new Set((snapshot.claims ?? []).map((c) => c.id));
  const addressed = new Set(
    graph.edges.filter((e) => e.rel === 'addresses' && claimIds.has(e.from)).map((e) => e.to),
  );
  const gaps = questions.filter((q) => !addressed.has(q.id));
  if (gaps.length === 0) return null;

  return {
    rule: 'question-gaps',
    action: 'Close the evidence gap for unaddressed research questions',
    why: [
      `${gaps.length} research question(s) have zero claims addressing them: ${gaps.map((q) => q.id).join(', ')}`,
    ],
    impact: 'medium',
    command: `phdude add claim --json '{"statement":"…","questions":["${gaps[0].id}"]}'`,
    dependents: gaps.length,
  };
}

const GAPS_THRESHOLD = 3;

function gapSummary(gaps) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const g of gaps) counts[g.severity]++;
  return `${gaps.length} gap(s) found: high=${counts.high}, medium=${counts.medium}, low=${counts.low}`;
}

// Not a plain RULES member: it reads the gap report rather than the snapshot, and recommendNext
// shares that one report with ruleConsistent below. A single high-severity gap - a live
// contradiction, say - outranks the count on its own; the ranking, not the rule, decides where
// it lands next to the higher-impact rules.
function ruleGaps(gaps) {
  const highest = gaps.some((g) => g.severity === 'high');
  if (!highest && gaps.length < GAPS_THRESHOLD) return null;

  return {
    rule: 'gaps',
    action: 'Review the research gaps report',
    why: [gapSummary(gaps)],
    impact: 'medium',
    command: 'phdude gaps',
    dependents: gaps.length,
  };
}

// The last line of a `next` run is the one an agent reads as the verdict, so it must never
// claim consistency the gap report would contradict.
function ruleConsistent(hasOtherActions, gaps) {
  if (gaps.length > 0) {
    return {
      rule: 'consistent',
      action: `${gaps.length} open gap(s); run phdude gaps`,
      why: [gapSummary(gaps)],
      impact: 'low',
      command: '',
      dependents: 0,
    };
  }
  if (hasOtherActions) {
    return {
      rule: 'consistent',
      action: 'No further automatic recommendations; add new sources or refine claims',
      why: ['all rule-based checks above are the open items'],
      impact: 'low',
      command: '',
      dependents: 0,
    };
  }
  return {
    rule: 'consistent',
    action: 'Workspace is consistent; add new sources or refine claims',
    why: ['no open conflicts, unsupported claims, or pending decisions were found'],
    impact: 'low',
    command: '',
    dependents: 0,
  };
}

const RULES = [
  ruleNoQuestions,
  ruleExtractionUnavailable,
  ruleUnknownRoles,
  ruleOpenConflicts,
  ruleUnsupportedClaims,
  ruleCandidateBacklog,
  rulePacksRecommended,
  rulePendingDecisions,
  ruleQuestionGaps,
];

/**
 * @param {object} snapshot - a WorkspaceSnapshot (see application/snapshot.js)
 * @param {object[]} conflicts - all fact conflicts (open and resolved), from domain/conflicts.js
 * @returns {{rule: string, action: string, why: string[], impact: 'high'|'medium'|'low', command: string, dependents: number}[]}
 */
export function recommendNext(snapshot, conflicts) {
  const scored = [];
  RULES.forEach((rule, order) => {
    const action = rule(snapshot, conflicts);
    if (action) scored.push({ action, order });
  });

  const gaps = findGaps(snapshot, conflicts);
  const gapsAction = ruleGaps(gaps);
  if (gapsAction) scored.push({ action: gapsAction, order: RULES.length });

  scored.push({ action: ruleConsistent(scored.length > 0, gaps), order: RULES.length + 1 });

  scored.sort(
    (a, b) =>
      IMPACT_RANK[a.action.impact] - IMPACT_RANK[b.action.impact] ||
      b.action.dependents - a.action.dependents ||
      a.order - b.order,
  );

  return scored.map((s) => s.action);
}

import { buildGraph } from './lineage.js';
import { sectionClaims } from './context-budget.js';
import { openConflicts } from './conflicts.js';
import { questionFreshness } from './freshness.js';
import { findGaps } from './gaps.js';
import { makeHashId } from './ids.js';
import { DEFAULT_FILTERS, ENABLE_EXECUTION, ENABLE_NETWORK } from './policy.js';

const IMPACT_RANK = { high: 0, medium: 1, low: 2 };
// How long a review queue has to be before it is worth an afternoon. Candidate claims and
// literature candidates are the same kind of backlog, so they share the number.
const BACKLOG_THRESHOLD = 5;
const COLLECTION_KEYS = [
  'artifacts',
  'sources',
  'claims',
  'evidence',
  'facts',
  'results',
  'datasets',
  'analyses',
  'tables',
  'figures',
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
  if (candidates.length < BACKLOG_THRESHOLD) return null;
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

// Literature ages whether or not anyone looks at it, so this rule fires on the calendar rather
// than on anything the researcher did: a question nobody has searched, and a question whose
// search has passed the policy's threshold, are the same problem at different stages.
function ruleStaleSearch(snapshot) {
  const questions = snapshot.questions ?? [];
  if (questions.length === 0) return null;

  const staleAfterDays = snapshot.staleAfterDays ?? DEFAULT_FILTERS.staleAfterDays;
  const rows = questionFreshness(questions, snapshot.searches ?? [], snapshot.now, staleAfterDays);
  const stale = rows.filter((row) => row.stale);
  if (stale.length === 0) return null;

  const never = stale.filter((row) => row.lastSearch === null);
  const aged = stale.filter((row) => row.lastSearch !== null);
  const why = [
    `${stale.length} research question(s) have no current literature search: ${stale.map((r) => r.question).join(', ')}`,
  ];
  if (never.length > 0) {
    why.push(
      never.length === 1
        ? '1 of them has never been searched'
        : `${never.length} of them have never been searched`,
    );
  }
  if (aged.length > 0) {
    const oldest = aged.reduce((worst, row) => (row.daysAgo > worst.daysAgo ? row : worst));
    why.push(`the oldest search ran ${oldest.daysAgo} day(s) ago (stale after ${staleAfterDays})`);
  }

  const first = stale[0];
  const text = questions.find((q) => q.id === first.question)?.text ?? '…';
  const command =
    first.lastSearch === null
      ? `phdude research "${text}" --question ${first.question}`
      : `phdude research-fresh --question ${first.question}`;
  return {
    rule: 'stale-search',
    action: 'Refresh the literature behind the research questions',
    why,
    impact: 'medium',
    // With the network closed the search command would refuse, so the step before it is the
    // recommendation: the policy is the researcher's to open, not the agent's.
    command: snapshot.networkEnabled === false ? `${ENABLE_NETWORK}, then ${command}` : command,
    dependents: stale.length,
  };
}

// Candidates pile up because searching is cheap and reviewing is not. A backlog is not an
// error - it is the queue the researcher owns - so it is reported once the queue is long
// enough to be worth an afternoon, never per candidate.
function ruleCandidatesPending(snapshot) {
  const pending = (snapshot.candidates ?? []).filter((c) => c.state === 'candidate');
  if (pending.length < BACKLOG_THRESHOLD) return null;
  return {
    rule: 'candidates-pending',
    action: 'Review the literature candidates waiting for a verdict',
    why: [`${pending.length} candidate(s) from literature searches are still unreviewed`],
    impact: 'medium',
    command: 'phdude research list --state candidate',
    dependents: pending.length,
  };
}

// A section is ready to write when the plan attached claims to it and every one of them is
// already supported or canonical: the prose would have something to say and the evidence to say
// it with. A section whose claims are still candidates is not ready, it is research.
function ruleSectionsPlanned(snapshot) {
  const manuscript = snapshot.manuscript;
  if (!manuscript) return null;

  const ready = manuscript.sections
    .filter((section) => section.status === 'planned')
    .map((section) => ({ section, claims: sectionClaims(section, snapshot) }))
    .filter(
      ({ claims }) =>
        claims.length > 0 &&
        claims.every((claim) => ['supported', 'canonical'].includes(claim.state)),
    )
    .map(({ section }) => section)
    .sort((a, b) => a.order - b.order);
  if (ready.length === 0) return null;

  return {
    rule: 'sections-planned',
    action: 'Draft the manuscript sections whose evidence is already in',
    why: [
      `${ready.length} planned section(s) have supported or canonical claims behind them: ${ready.map((s) => s.id).join(', ')}`,
    ],
    impact: 'medium',
    command: `phdude write ${ready[0].id}`,
    dependents: ready.length,
  };
}

// A blocked submit is the writing pipeline refusing prose that outran its evidence. Nothing
// downstream of it can happen until the draft is fixed, which is why it outranks the rest of
// the manuscript rules.
function ruleDraftBlocked(snapshot) {
  const blocked = (snapshot.sectionReports ?? [])
    .filter((report) => (report.blocks ?? 0) > 0)
    .sort((a, b) => (a.section < b.section ? -1 : 1));
  if (blocked.length === 0) return null;

  const total = blocked.reduce((sum, report) => sum + report.blocks, 0);
  return {
    rule: 'draft-blocked',
    action: 'Fix the draft the writing gates refused',
    why: [
      `${blocked.length} section(s) have blocking findings in their last report: ${blocked.map((r) => `${r.section} (${r.blocks})`).join(', ')}`,
      `${total} blocking finding(s) in total`,
    ],
    impact: 'high',
    command: `phdude prose ${blocked[0].section}`,
    dependents: blocked.length,
  };
}

// Revised prose is prose nobody has signed. The approval is the researcher's, never the
// agent's, so the recommendation is to decide - not to approve.
function ruleApprovalPending(snapshot) {
  const manuscript = snapshot.manuscript;
  if (!manuscript) return null;
  const pending = manuscript.sections
    .filter((section) => section.status === 'revised' && !section.approved_by)
    .sort((a, b) => a.order - b.order);
  if (pending.length === 0) return null;

  return {
    rule: 'approval-pending',
    action: 'Decide on the revised manuscript sections',
    why: [
      `${pending.length} revised section(s) have no approving decision: ${pending.map((s) => s.id).join(', ')}`,
    ],
    impact: 'medium',
    command: `phdude decide propose --title "Approve ${pending[0].id}" --rationale "…" --affects manuscript:${pending[0].id}`,
    dependents: pending.length,
  };
}

// Which RESULT ids a supported or canonical claim rests on, through the evidence citing them.
// A stale analysis behind one of those is a number the thesis already states plainly; a stale
// analysis nobody has cited yet is only work in progress, which is the whole difference in
// impact between the two.
function resultsBehindStatedClaims(snapshot) {
  const stated = (snapshot.claims ?? []).filter((c) =>
    ['supported', 'canonical'].includes(c.state),
  );
  const cited = new Set(stated.flatMap((c) => c.supported_by ?? []));
  return new Set((snapshot.evidence ?? []).filter((e) => cited.has(e.id)).map((e) => e.source));
}

// An input whose file no longer matches the DATASET record is a different fix from an input that
// merely moved: `analyze run` refuses it outright, because recording the registered hash for
// bytes it did not read would write down a lineage the run never had. Clearing it takes three
// steps, and all three can be named here - a dataset's id is the hash of its bytes, and the
// staleness report already carries the hash the file has now.
function redeclare(snapshot, item) {
  const analysis = (snapshot.analyses ?? []).find((a) => a.id === item.id);
  const drifted = item.reasons.filter((reason) => reason.kind === 'unregistered-input');
  if (analysis === undefined || drifted.length === 0) return null;

  const byId = new Map((snapshot.datasets ?? []).map((d) => [d.id, d]));
  const registered = new Map();
  const why = [];
  for (const reason of drifted) {
    const path = byId.get(reason.input)?.path;
    if (path === undefined) return null;
    why.push(`${path} is not the file ${reason.input} was registered against`);
    registered.set(reason.input, [path, makeHashId('dataset', reason.current)]);
  }

  const declaration = {
    name: analysis.name,
    runtime: analysis.runtime,
    script: analysis.script,
    args: analysis.args ?? [],
    inputs: (analysis.inputs ?? []).map((id) => registered.get(id)?.[1] ?? id),
    outputs: analysis.outputs,
    params: analysis.params ?? {},
  };

  return {
    why,
    command: [
      ...[...registered.values()].map(([path]) => `phdude data add ${path}`),
      `phdude analyze add --json '${JSON.stringify(declaration)}'`,
      `phdude analyze run ${analysis.id}`,
    ].join(', then '),
  };
}

// A run only stays true as long as its inputs do. `repro check` reports the same items; this is
// the one line of it that belongs in "what should I do next", ranked by whether the numbers it
// produced are already in the argument.
function ruleAnalysisStale(snapshot) {
  const stale = (snapshot.repro ?? []).filter(
    (item) => item.kind === 'analysis' && item.status === 'stale',
  );
  if (stale.length === 0) return null;

  const stated = resultsBehindStatedClaims(snapshot);
  const staleIds = new Set(stale.map((item) => item.id));
  const load = (snapshot.results ?? []).filter(
    (r) => staleIds.has(r.from) && stated.has(r.id) && r.state !== 'rejected',
  );

  const why = stale
    .slice(0, 3)
    .map((item) => `${item.id} (${item.name}) read inputs that have changed since its last run`);
  if (stale.length > 3) why.push(`and ${stale.length - 3} more`);
  if (load.length > 0) {
    why.push(
      `${load.length} result(s) behind a supported or canonical claim came from them: ` +
        load
          .map((r) => r.id)
          .sort()
          .join(', '),
    );
  }

  const drift = redeclare(snapshot, stale[0]);
  if (drift !== null) why.push(...drift.why);
  const command = drift === null ? `phdude analyze run ${stale[0].id}` : drift.command;

  return {
    rule: 'analysis-stale',
    action: 'Re-run the analyses whose data has changed',
    why,
    impact: load.length > 0 ? 'high' : 'medium',
    command: snapshot.executionEnabled === false ? `${ENABLE_EXECUTION}, then ${command}` : command,
    dependents: stale.length,
  };
}

// Alt text is the one field a figure cannot be published without (PRD S100), and `figure add`
// refuses a figure that has none - so this fires only on a record that was edited afterwards.
function ruleFigureMissingAlt(snapshot) {
  const missing = (snapshot.figures ?? [])
    .filter((figure) => String(figure.alt ?? '').trim() === '')
    .sort((a, b) => a.id.localeCompare(b.id));
  if (missing.length === 0) return null;

  return {
    rule: 'figure-missing-alt',
    action: 'Restore the alt text on the figures that lost it',
    why: [
      `${missing.length} figure(s) have no alt text: ${missing.map((f) => `${f.id} (${f.name})`).join(', ')}`,
    ],
    impact: 'medium',
    command: `phdude figure add --json '{"name":"${missing[0].name}","alt":"…"}'`,
    dependents: missing.length,
  };
}

// Declared and never produced. It is `low` because nothing is wrong with the record - the work
// simply has not been done - which is the same reading `claim-unwritten` takes in the gap report.
function ruleNeverRun(snapshot) {
  const BUILD = { analysis: 'analyze run', table: 'table build', figure: 'figure build' };
  const pending = (snapshot.repro ?? []).filter((item) =>
    ['never-run', 'missing-output'].includes(item.status),
  );
  if (pending.length === 0) return null;

  const never = pending.filter((item) => item.status === 'never-run');
  const gone = pending.filter((item) => item.status === 'missing-output');
  const why = [
    `${pending.length} declared item(s) have no output on disk: ` +
      pending
        .slice(0, 3)
        .map((item) => `${item.id} (${item.name})`)
        .join(', '),
  ];
  if (never.length > 0) why.push(`${never.length} of them have never been run`);
  if (gone.length > 0) why.push(`${gone.length} of them wrote an output that is no longer there`);

  return {
    rule: 'never-run',
    action: 'Produce the analyses, tables and figures that were declared but never built',
    why,
    impact: 'low',
    command: `phdude ${BUILD[pending[0].kind]} ${pending[0].id}`,
    dependents: pending.length,
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
  ruleStaleSearch,
  ruleCandidatesPending,
  ruleDraftBlocked,
  ruleSectionsPlanned,
  ruleApprovalPending,
  ruleAnalysisStale,
  ruleFigureMissingAlt,
  ruleNeverRun,
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

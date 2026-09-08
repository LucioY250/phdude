// The writing context (PRD §70, spec §3.3): everything the agent needs to draft one section,
// in priority order, inside a budget. What makes this a budget rather than a dump is the
// priority: the task instruction and the canonical facts come first, the section's claims with
// their evidence next, and the reference material an agent can work without comes last. When
// the budget runs out, the lowest-priority item is the one that goes.
//
// Pure: it is handed a snapshot, not a store, and it returns Markdown plus the ledger of what
// it included and what it had to leave out, so `phdude write` can print both.

import { sectionPurpose, slugify } from './manuscript.js';

export const DEFAULT_BUDGET_CHARS = 12000;

// The order is the priority order of PRD §70; `kind` is what the ledger reports.
const PRIORITY = ['instruction', 'facts', 'claim', 'bibkeys', 'policy', 'voice', 'epistemic'];

// Which verb each claim state may use, from the epistemic-language reference. Only the rows for
// the states the section actually asserts are carried into the context.
const EPISTEMIC_TABLE = [
  {
    state: 'candidate',
    allowed: 'suggests, indicates, is consistent with, points toward, may reflect',
    forbidden: 'shows, demonstrates, proves, establishes',
  },
  {
    state: 'supported',
    allowed: 'shows, provides evidence for, is associated with, supports, reports',
    forbidden: 'demonstrates, proves, causes',
  },
  {
    state: 'canonical',
    allowed: 'demonstrates, establishes, shows',
    forbidden: 'proves (reserve for mathematics)',
  },
  {
    state: 'disputed',
    allowed: 'name both sides: "X reports …, while Y reports …"',
    forbidden: 'any verb that picks a side silently',
  },
  {
    state: 'rejected',
    allowed: 'do not assert the claim at all',
    forbidden: 'every verb',
  },
];

function byId(objects) {
  return new Map((objects ?? []).map((obj) => [obj.id, obj]));
}

const STRENGTH_RANK = { strong: 0, moderate: 1, weak: 2 };

// The evidence a paragraph should quote: the strongest item behind the claim, ties broken by id
// so two runs of `phdude write` produce the same context.
function strongestEvidence(claim, evidenceById) {
  const items = (claim.supported_by ?? []).map((id) => evidenceById.get(id)).filter(Boolean);
  if (items.length === 0) return null;
  return [...items].sort(
    (a, b) =>
      (STRENGTH_RANK[a.strength] ?? 3) - (STRENGTH_RANK[b.strength] ?? 3) || (a.id < b.id ? -1 : 1),
  )[0];
}

/**
 * The claims this section is written from, in the order the workspace can be asked for them:
 * the plan's own list first, then the claims that name this section themselves (`sections:` on
 * a claim is where a researcher records "this belongs in the Results"), and only then the
 * claims that address the section's questions. A section that comes up empty is not a failure -
 * it is a section with nothing recorded to say yet, and the context says so.
 *
 * `next`'s `sections-planned` rule asks the same question, and has to get the same answer.
 *
 * @param {object} section - a manuscript section entry
 * @param {object} snapshot
 * @returns {object[]} the claims, sorted by id
 */
export function sectionClaims(section, snapshot) {
  const claims = snapshot.claims ?? [];
  const byIdAsc = (a, b) => (a.id < b.id ? -1 : 1);

  const planned = (section.claims ?? [])
    .map((id) => claims.find((claim) => claim.id === id))
    .filter(Boolean);
  if (planned.length > 0) return planned.sort(byIdAsc);

  const named = claims.filter((claim) =>
    (claim.sections ?? []).some((name) => slugify(name) === section.id),
  );
  if (named.length > 0) return named.sort(byIdAsc);

  const questions = new Set(section.questions ?? []);
  if (questions.size === 0) return [];
  return claims
    .filter(
      (claim) =>
        ['supported', 'canonical'].includes(claim.state) &&
        (claim.questions ?? []).some((id) => questions.has(id)),
    )
    .sort(byIdAsc);
}

function instructionBlock(snapshot, section) {
  const manuscript = snapshot.manuscript ?? {};
  const purpose = sectionPurpose(section.id);
  const lines = [
    `# Writing context: ${section.title}`,
    '',
    `Manuscript: ${manuscript.title ?? '(untitled)'} (language ${manuscript.language ?? 'en'})`,
    `Section: ${section.id} (${section.status}), position ${section.order}`,
  ];
  if (purpose) lines.push('', `Purpose: ${purpose}`);
  return { kind: 'instruction', id: section.id, mandatory: true, markdown: lines.join('\n') };
}

function factsBlock(snapshot) {
  const lines = ['## Canonical project facts', ''];
  lines.push(`- Title: ${snapshot.project?.title ?? '(untitled)'}`);

  const questions = snapshot.questions ?? [];
  if (questions.length === 0) {
    lines.push('- Research questions: none recorded');
  } else {
    lines.push('- Research questions:');
    for (const question of questions) lines.push(`  - ${question.id}: ${question.text}`);
  }

  const methods = snapshot.methods ?? [];
  if (methods.length === 0) {
    lines.push('- Methods: none recorded');
  } else {
    lines.push('- Methods:');
    for (const method of methods) {
      lines.push(`  - ${method.id}: ${method.name} (${method.paradigm}) — ${method.design}`);
    }
  }

  const facts = (snapshot.facts ?? []).filter((fact) =>
    ['canonical', 'supported'].includes(fact.state),
  );
  if (facts.length > 0) {
    lines.push('- Established values:');
    for (const fact of facts) {
      const unit = fact.unit ? ` ${fact.unit}` : '';
      lines.push(`  - ${fact.id}: ${fact.key} = ${fact.value}${unit} (${fact.state})`);
    }
  }

  return { kind: 'facts', id: 'canonical', markdown: lines.join('\n') };
}

function claimBlock(claim, evidenceById, bibkeys, sourcesById) {
  const evidence = strongestEvidence(claim, evidenceById);
  const lines = [`### ${claim.id} (${claim.state})`, '', claim.statement, ''];
  lines.push(`- Assert it with: <!-- claim: ${claim.id} -->`);

  if (!evidence) {
    lines.push('- Evidence: none recorded; do not assert this claim as a finding');
  } else {
    const bibkey = bibkeys?.get(evidence.source) ?? null;
    const source = sourcesById?.get(evidence.source) ?? null;
    const cite = bibkey ? `[@${bibkey}]` : source ? `[@${source.id}]` : '(no source to cite)';
    lines.push(`- Strongest evidence: ${evidence.id} (${evidence.strength}), cite as ${cite}`);
    lines.push(`- Locator: ${evidence.locator}`);
    lines.push(`- Excerpt: "${evidence.excerpt}"`);
  }

  return { kind: 'claim', id: claim.id, markdown: lines.join('\n') };
}

function bibkeysBlock(sources, bibkeys) {
  const lines = ['## Citation keys available', ''];
  if (sources.length === 0) {
    lines.push(
      'None. Do not cite anything: a citation with no source behind it blocks the submit.',
    );
  } else {
    for (const source of sources) {
      const year = source.year ?? 'n.d.';
      lines.push(`- [@${bibkeys.get(source.id) ?? source.id}] — ${source.title} (${year})`);
    }
    lines.push('', 'Cite only these keys. A key that resolves to nothing blocks the submit.');
  }
  return { kind: 'bibkeys', id: 'sources', markdown: lines.join('\n') };
}

function policyBlock(policy) {
  const writing = policy?.writing ?? null;
  const lines = ['## Writing policy', ''];
  if (!writing) {
    lines.push('No writing policy recorded; follow the academic-prose skill.');
  } else {
    if (writing.language) lines.push(`- Language: ${writing.language}`);
    for (const [key, value] of Object.entries(writing.tone ?? {})) {
      lines.push(`- Tone ${key}: ${value}`);
    }
    if ((writing.avoid ?? []).length > 0) {
      lines.push(`- Avoid: ${writing.avoid.join(', ')}`);
    }
  }
  return { kind: 'policy', id: 'writing-policy', markdown: lines.join('\n') };
}

function voiceBlock(profile) {
  const lines = ['## Author voice', ''];
  if (!profile) {
    lines.push('No author voice profile is active; write in the manuscript language, plainly.');
    return { kind: 'voice', id: 'none', markdown: lines.join('\n') };
  }

  lines.push(`Profile: ${profile.id ?? profile.name ?? '(unnamed)'}`);
  const learned = profile.learned ?? {};
  const entries = Object.entries(learned).filter(
    ([, value]) => value !== null && value !== undefined,
  );
  if (entries.length > 0) {
    lines.push('', 'Learned from approved samples:');
    for (const [key, value] of entries.sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (typeof value === 'object') continue;
      lines.push(`- ${key}: ${value}`);
    }
  }
  const preserve = profile.terminology?.preserve ?? [];
  const avoid = profile.terminology?.avoid ?? [];
  if (preserve.length > 0) lines.push('', `Preserve: ${preserve.join(', ')}`);
  if (avoid.length > 0) lines.push(`Avoid: ${avoid.join(', ')}`);

  return { kind: 'voice', id: profile.id ?? 'profile', markdown: lines.join('\n') };
}

function epistemicBlock(states, table) {
  const rows = table.filter((row) => states.has(row.state));
  const lines = ['## Which verb each claim allows', ''];
  if (rows.length === 0) {
    lines.push('No claims are attached to this section, so nothing here may be asserted.');
    return { kind: 'epistemic', id: 'verbs', markdown: lines.join('\n') };
  }
  lines.push('| State | Use | Never |', '| --- | --- | --- |');
  for (const row of rows) lines.push(`| ${row.state} | ${row.allowed} | ${row.forbidden} |`);
  return { kind: 'epistemic', id: 'verbs', markdown: lines.join('\n') };
}

/**
 * Assembles the writing context for one section.
 *
 * Items are built in the priority order of PRD §70 and taken in that order while the budget
 * holds. The first item that does not fit, and every item after it, is reported in `truncated`
 * rather than silently shortened - a half-quoted excerpt would be worse than a missing one. The
 * task instruction is always included: it is the contract, not context.
 *
 * @param {object} snapshot - a WorkspaceSnapshot carrying `manuscript` (see application/snapshot.js)
 * @param {string} sectionId
 * @param {{profile?: object|null, policy?: object|null, budgetChars?: number,
 *   bibkeys?: Map<string, string>, epistemicTable?: object[]}} [options]
 * @returns {{markdown: string, included: {kind: string, id: string, chars: number}[],
 *   truncated: {kind: string, id: string}[], section: object}}
 */
export function assembleContext(snapshot, sectionId, options = {}) {
  const {
    profile = null,
    policy = null,
    budgetChars = DEFAULT_BUDGET_CHARS,
    bibkeys = new Map(),
    epistemicTable = EPISTEMIC_TABLE,
  } = options;

  const manuscript = snapshot.manuscript;
  const section = (manuscript?.sections ?? []).find((entry) => entry.id === sectionId);
  if (!section) return null;

  const evidenceById = byId(snapshot.evidence);
  const sourcesById = byId(snapshot.sources);
  const claims = sectionClaims(section, snapshot);
  const sources = [...(snapshot.sources ?? [])].sort((a, b) =>
    (bibkeys.get(a.id) ?? a.id) < (bibkeys.get(b.id) ?? b.id) ? -1 : 1,
  );

  const items = [
    instructionBlock(snapshot, section),
    factsBlock(snapshot),
    ...claims.map((claim) => claimBlock(claim, evidenceById, bibkeys, sourcesById)),
    bibkeysBlock(sources, bibkeys),
    policyBlock(policy),
    voiceBlock(profile),
    epistemicBlock(new Set(claims.map((claim) => claim.state)), epistemicTable),
  ];

  return { ...takeWithinBudget(items, budgetChars), section };
}

// Items are taken in priority order while the budget holds. The first item that does not fit,
// and every item after it, is reported in `truncated` rather than silently shortened - a
// half-quoted excerpt would be worse than a missing one. A `mandatory` item is always included:
// it is the contract, not context.
function takeWithinBudget(items, budgetChars) {
  const included = [];
  const truncated = [];
  const parts = [];
  let used = 0;
  let full = false;

  for (const item of items) {
    const chars = item.markdown.length;
    if (!item.mandatory && (full || used + chars > budgetChars)) {
      full = true;
      truncated.push({ kind: item.kind, id: item.id });
      continue;
    }
    used += chars;
    parts.push(item.markdown);
    included.push({ kind: item.kind, id: item.id, chars });
  }

  return { markdown: parts.join('\n\n') + '\n', included, truncated };
}

export { PRIORITY, EPISTEMIC_TABLE };

// The review context (spec §3.2). Same budgeting as the writing context and the same ledger,
// but assembled around what is being reviewed rather than what is being written: the reviewer
// is handed the target, the claims and evidence behind it, the methods, what reproduces and
// what does not, and the findings already recorded, so a review cannot repeat itself.

const REVIEW_CHECKLISTS = {
  citation: [
    'Does every `[@key]` in the prose resolve to a source the workspace records?',
    'Does every source carry a title, at least one author, and a year?',
    'Is every identifier well-formed, and does it name the work it claims to?',
    'Is any source cited while still a candidate, or dismissed and cited anyway?',
  ],
  methodology: [
    'Does the design answer the question it is attached to, or a neighbouring one?',
    'Is the sampling strategy stated, and does it support the population the claims speak about?',
    'Are the instruments named, and is their validity or reliability recorded anywhere?',
    'Which validity threats are declared as limitations, and which are visible but undeclared?',
    'Does the reporting follow the standard the field pack recommends for this design?',
  ],
  reviewer2: [
    'Which claim asserts more than the evidence behind it supports?',
    'Which finding is stated as established when its state is candidate or disputed?',
    'Which alternative explanation is never considered?',
    'Which comparison is made against a weak or absent baseline?',
    'Which recorded contradiction does the argument walk past?',
  ],
  reproducibility: [
    'Which analysis, table or figure is stale, never run, or missing its output?',
    'Does every analysis declare the datasets it reads and where it writes results?',
    'Is every number in the prose traceable to a RESULT or a FACT that still holds?',
    'Is the data behind each claim registered, or only described?',
  ],
  custom: [
    'State what you were asked to look at, and answer only that.',
    'Every finding names the ids it rests on.',
  ],
};

// Which blocks a kind of review needs first. Every kind gets every block; the order decides
// what survives when the budget runs out.
const REVIEW_ORDER = {
  citation: [
    'instruction',
    'checklist',
    'target',
    'facts',
    'claims',
    'methods',
    'reviews',
    'repro',
  ],
  methodology: [
    'instruction',
    'checklist',
    'target',
    'facts',
    'methods',
    'claims',
    'reviews',
    'repro',
  ],
  reviewer2: [
    'instruction',
    'checklist',
    'target',
    'facts',
    'claims',
    'methods',
    'reviews',
    'repro',
  ],
  reproducibility: [
    'instruction',
    'checklist',
    'target',
    'facts',
    'repro',
    'claims',
    'methods',
    'reviews',
  ],
  custom: ['instruction', 'checklist', 'target', 'facts', 'claims', 'methods', 'reviews', 'repro'],
};

/**
 * What a review target names: the whole project, one manuscript section, or one object.
 * @param {object} snapshot
 * @param {string} target
 * @returns {{kind: 'project'|'section'|'entity', id: string, object?: object, section?: object}|null}
 */
export function resolveReviewTarget(snapshot, target) {
  if (target === 'project') return { kind: 'project', id: 'project' };

  const section = /^manuscript:([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(String(target ?? ''));
  if (section) {
    const entry = (snapshot.manuscript?.sections ?? []).find((s) => s.id === section[1]);
    return entry === undefined ? null : { kind: 'section', id: target, section: entry };
  }

  const object = (snapshot.graph?.nodes ?? new Map()).get(target);
  return object === undefined ? null : { kind: 'entity', id: target, object };
}

function reviewInstructionBlock(snapshot, kind, resolved) {
  const lines = [
    `# Review context: ${kind}`,
    '',
    `Project: ${snapshot.project?.title ?? '(untitled)'}`,
    `Review mode: ${snapshot.project?.mode ?? 'full'}`,
    `Target: ${resolved.id} (${resolved.kind})`,
    '',
    'You are reviewing what the workspace records, not what you remember. Every finding names',
    'the ids it rests on, and a finding you cannot attach to a recorded id is a question for the',
    'researcher rather than a finding.',
  ];
  return { kind: 'instruction', id: kind, mandatory: true, markdown: lines.join('\n') };
}

function reviewChecklistBlock(kind) {
  const questions = REVIEW_CHECKLISTS[kind] ?? REVIEW_CHECKLISTS.custom;
  const lines = ['## What this review asks', ''];
  for (const question of questions) lines.push(`- ${question}`);
  return { kind: 'checklist', id: kind, mandatory: true, markdown: lines.join('\n') };
}

function targetBlock(snapshot, resolved) {
  const lines = ['## Under review', ''];

  if (resolved.kind === 'project') {
    const sections = snapshot.manuscript?.sections ?? [];
    lines.push(`- Objects recorded: ${(snapshot.graph?.nodes ?? new Map()).size}`);
    if (sections.length === 0) {
      lines.push('- Manuscript: none planned');
    } else {
      lines.push('- Manuscript sections:');
      for (const section of [...sections].sort((a, b) => a.order - b.order)) {
        lines.push(`  - ${section.id} (${section.status})`);
      }
    }
  } else if (resolved.kind === 'section') {
    const body = snapshot.sectionBodies?.[resolved.section.id] ?? null;
    lines.push(`- Section: ${resolved.section.id} (${resolved.section.status})`);
    lines.push(`- Title: ${resolved.section.title}`);
    lines.push('');
    lines.push(body === null ? '(no prose written yet)' : body.trim());
  } else {
    const object = resolved.object;
    lines.push(`- ${object.id} (${object.schema})`);
    for (const [key, value] of Object.entries(object)) {
      if (['schema', 'version', 'id', 'created', 'actor'].includes(key)) continue;
      if (value === null || value === undefined) continue;
      const rendered = Array.isArray(value) ? value.join(', ') : String(value);
      if (rendered === '' || rendered === '[object Object]') continue;
      lines.push(`- ${key}: ${rendered}`);
    }
  }

  return { kind: 'target', id: resolved.id, markdown: lines.join('\n') };
}

function reviewClaimsBlock(snapshot, resolved) {
  const evidenceById = byId(snapshot.evidence);
  const sourcesById = byId(snapshot.sources);
  const claims = reviewClaims(snapshot, resolved);

  const lines = ['## Claims in scope', ''];
  if (claims.length === 0) {
    lines.push('None recorded for this target.');
    return { kind: 'claims', id: resolved.id, markdown: lines.join('\n') };
  }

  for (const claim of claims) {
    lines.push(`### ${claim.id} (${claim.state})`, '', claim.statement, '');
    const items = (claim.supported_by ?? []).map((id) => evidenceById.get(id)).filter(Boolean);
    if (items.length === 0) {
      lines.push('- Evidence: none recorded');
    } else {
      for (const item of items) {
        const source = sourcesById.get(item.source);
        const where = source ? `${source.title} (${source.year ?? 'n.d.'})` : item.source;
        lines.push(`- ${item.id} (${item.strength}) from ${where}: "${item.excerpt}"`);
      }
    }
    if ((claim.questions ?? []).length > 0) lines.push(`- Answers: ${claim.questions.join(', ')}`);
    if ((claim.contradicts ?? []).length > 0) {
      lines.push(`- Contradicts: ${claim.contradicts.join(', ')}`);
    }
    lines.push('');
  }

  return { kind: 'claims', id: resolved.id, markdown: lines.join('\n').trimEnd() };
}

// Which claims a review of this target is about: the section's own claims, the claim itself
// when one is under review, and otherwise every claim the project asserts.
function reviewClaims(snapshot, resolved) {
  if (resolved.kind === 'section') return sectionClaims(resolved.section, snapshot);
  if (resolved.kind === 'entity' && resolved.object.schema === 'phdude.claim') {
    return [resolved.object];
  }
  return [...(snapshot.claims ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1));
}

function methodsBlock(snapshot) {
  const methods = snapshot.methods ?? [];
  const lines = ['## Methods as recorded', ''];
  if (methods.length === 0) {
    lines.push('None recorded. A study with no recorded method cannot be reviewed for one.');
    return { kind: 'methods', id: 'methods', markdown: lines.join('\n') };
  }
  for (const method of methods) {
    lines.push(`### ${method.id}: ${method.name} (${method.paradigm})`, '');
    lines.push(`- Design: ${method.design || '(not stated)'}`);
    lines.push(`- Sampling: ${method.sampling || '(not stated)'}`);
    lines.push(`- Instruments: ${(method.instruments ?? []).join(', ') || '(none listed)'}`);
    lines.push(`- Analysis: ${(method.analysis ?? []).join(', ') || '(none listed)'}`);
    lines.push(`- Limitations: ${(method.limitations ?? []).join('; ') || '(none declared)'}`);
    lines.push(`- Answers: ${(method.questions ?? []).join(', ') || '(no question attached)'}`);
    lines.push('');
  }
  return { kind: 'methods', id: 'methods', markdown: lines.join('\n').trimEnd() };
}

function reproBlock(snapshot) {
  const items = snapshot.repro ?? [];
  const lines = ['## What reproduces, and what does not', ''];
  if (items.length === 0) {
    lines.push('Nothing is declared as an analysis, table or figure.');
    return { kind: 'repro', id: 'repro', markdown: lines.join('\n') };
  }
  for (const item of items) {
    lines.push(`- ${item.id} (${item.kind}) ${item.name}: ${item.status}`);
    for (const reason of item.reasons ?? []) {
      lines.push(`  - ${reason.kind}${reason.input ? ` ${reason.input}` : ''}`);
    }
  }
  return { kind: 'repro', id: 'repro', markdown: lines.join('\n') };
}

function openReviewsBlock(snapshot, resolved) {
  const open = (snapshot.reviews ?? []).filter(
    (review) => review.status === 'open' || review.status === 'accepted',
  );
  const lines = ['## Findings already recorded', ''];
  if (open.length === 0) {
    lines.push('None. Nothing has been said about this project yet.');
    return { kind: 'reviews', id: resolved.id, markdown: lines.join('\n') };
  }
  lines.push('Do not repeat these; say so only if you disagree, and say why.', '');
  for (const review of open) {
    lines.push(
      `- ${review.id} [${review.severity}/${review.status}] ${review.kind} on ${review.target}: ${review.message}`,
    );
  }
  return { kind: 'reviews', id: resolved.id, markdown: lines.join('\n') };
}

/**
 * Assembles the review context for one target.
 *
 * @param {object} snapshot - a WorkspaceSnapshot (see application/snapshot.js)
 * @param {{kind: string, target: string, budgetChars?: number}} options
 * @returns {{markdown: string, included: object[], truncated: object[],
 *   target: {kind: string, id: string}}|null} null when the target names nothing recorded
 */
export function assembleReviewContext(snapshot, { kind, target, budgetChars } = {}) {
  const resolved = resolveReviewTarget(snapshot, target);
  if (resolved === null) return null;

  const blocks = {
    instruction: reviewInstructionBlock(snapshot, kind, resolved),
    checklist: reviewChecklistBlock(kind),
    target: targetBlock(snapshot, resolved),
    facts: factsBlock(snapshot),
    claims: reviewClaimsBlock(snapshot, resolved),
    methods: methodsBlock(snapshot),
    repro: reproBlock(snapshot),
    reviews: openReviewsBlock(snapshot, resolved),
  };
  const order = REVIEW_ORDER[kind] ?? REVIEW_ORDER.custom;
  const items = order.map((name) => blocks[name]);

  return {
    ...takeWithinBudget(items, budgetChars ?? DEFAULT_BUDGET_CHARS),
    target: { kind: resolved.kind, id: resolved.id },
  };
}

export { REVIEW_CHECKLISTS };

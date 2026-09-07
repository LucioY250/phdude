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
  return { kind: 'instruction', id: section.id, markdown: lines.join('\n') };
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

  const included = [];
  const truncated = [];
  const parts = [];
  let used = 0;
  let full = false;

  for (const item of items) {
    const chars = item.markdown.length;
    const mandatory = item.kind === 'instruction';
    if (!mandatory && (full || used + chars > budgetChars)) {
      full = true;
      truncated.push({ kind: item.kind, id: item.id });
      continue;
    }
    used += chars;
    parts.push(item.markdown);
    included.push({ kind: item.kind, id: item.id, chars });
  }

  return { markdown: parts.join('\n\n') + '\n', included, truncated, section };
}

export { PRIORITY, EPISTEMIC_TABLE };

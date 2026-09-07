import { assignBibkeys } from '../domain/bibkey.js';
import { PhdudeError } from '../domain/errors.js';
import { citationsGate } from '../domain/gates/citations.js';
import { runGates } from '../domain/gates/index.js';
import {
  SECTION_ID_RE,
  canTransition,
  manuscriptAffects,
  newManuscript,
  parseSectionFile,
  renderSectionFile,
  sectionHash,
} from '../domain/manuscript.js';
import { parseId } from '../domain/ids.js';
import { assertUpToDate } from './guard.js';

// The gates `submit` runs by default. v0.4 Task 4 adds evidence, prose, voice and meaning to
// this list; the runner and the finding shape are already what they will produce.
export const DEFAULT_GATES = [citationsGate];

const NO_MANUSCRIPT_HINT = 'phdude manuscript init';

async function loadManuscript(store) {
  const manuscript = await store.readManuscript();
  if (manuscript === null) {
    throw new PhdudeError('USAGE', 'this workspace has no manuscript', NO_MANUSCRIPT_HINT, null);
  }
  return manuscript;
}

function findSection(manuscript, section) {
  const entry = manuscript.sections.find((s) => s.id === section);
  if (!entry) {
    throw new PhdudeError(
      'USAGE',
      `unknown section: ${section ?? '(none)'}`,
      `sections: ${manuscript.sections.map((s) => s.id).join(', ')}`,
      null,
    );
  }
  return entry;
}

function withSection(manuscript, section, patch) {
  return {
    ...manuscript,
    sections: manuscript.sections.map((entry) =>
      entry.id === section ? { ...entry, ...patch } : entry,
    ),
  };
}

// A section that is no longer approved must not keep the decision that approved it: leaving
// `approved_by` behind would claim an approval the status no longer carries.
function withoutApproval(entry) {
  const rest = { ...entry };
  delete rest.approved_by;
  return rest;
}

// The context the citation gate reads: every source by id and by bibkey, plus the sources whose
// accepting candidate the researcher has since dismissed.
async function gateContext(store) {
  const sources = await store.listEntities('source');
  const candidates = await store.listEntities('candidate');
  const bibkeys = assignBibkeys(sources);

  const dismissed = new Set(
    candidates.filter((c) => c.state === 'dismissed').map((candidate) => candidate.id),
  );
  const dismissedSources = new Map();
  for (const source of sources) {
    const from = source.ext?.research?.candidate;
    if (from && dismissed.has(from)) dismissedSources.set(source.id, from);
  }

  return {
    sourcesById: new Map(sources.map((source) => [source.id, source])),
    sourcesByBibkey: new Map(sources.map((source) => [bibkeys.get(source.id), source])),
    dismissedSources,
  };
}

function formatFinding(finding) {
  return `${finding.gate}:${finding.line} ${finding.message}`;
}

async function requireApprovingDecision(store, section, decision) {
  if (!decision) {
    throw new PhdudeError(
      'USAGE',
      'manuscript approve needs --decision',
      `phdude decide propose --title "…" --rationale "…" --affects manuscript:${section}`,
      null,
    );
  }
  const hint = `the decision must be approved and list manuscript:${section} in --affects`;

  if (parseId(decision)?.type !== 'decision') {
    throw new PhdudeError('POLICY', `unknown decision ${decision}`, hint, null);
  }
  const obj = await store.readEntity(decision);
  if (!obj || obj.schema !== 'phdude.decision') {
    throw new PhdudeError('POLICY', `unknown decision ${decision}`, hint, null);
  }
  if (obj.status !== 'approved') {
    throw new PhdudeError('POLICY', `decision ${decision} is not approved`, hint, null);
  }
  if (!obj.affects.some((target) => manuscriptAffects(target) === section)) {
    throw new PhdudeError(
      'POLICY',
      `decision ${decision} does not affect manuscript:${section}`,
      hint,
      null,
    );
  }
  return obj;
}

/**
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {{title?: string, language?: string, voice?: string}} input - `voice` is an author
 *   profile id, or `consensus` for the project voice
 * @returns {Promise<object>} the manuscript
 */
export async function init({ store, clock, actor }, { title, language, voice } = {}) {
  assertUpToDate(await store.readProject());

  if (await store.readManuscript()) {
    throw new PhdudeError(
      'POLICY',
      'this workspace already has a manuscript',
      'phdude manuscript status',
      null,
    );
  }

  const project = await store.readProject();
  const resolvedTitle = title ?? project?.title;
  if (!resolvedTitle) {
    throw new PhdudeError(
      'USAGE',
      'manuscript init needs --title',
      'phdude manuscript init --title "…"',
      null,
    );
  }

  let resolvedVoice = { kind: 'consensus' };
  if (voice !== undefined && voice !== null && voice !== 'consensus') {
    if (!SECTION_ID_RE.test(voice)) {
      throw new PhdudeError(
        'VALIDATION',
        `invalid voice: ${voice}`,
        '--voice takes an author profile id (lowercase words joined by "-") or "consensus"',
        null,
      );
    }
    resolvedVoice = { kind: 'author', author: voice };
  }

  const manuscript = newManuscript({
    title: resolvedTitle,
    language: language ?? project?.language ?? 'en',
    voice: resolvedVoice,
  });

  await store.writeManuscript(manuscript);
  await store.appendEvent({
    ts: clock(),
    op: 'manuscript',
    actor,
    ids: [],
    summary: `manuscript initialized (${manuscript.sections.length} sections)`,
  });
  return manuscript;
}

/**
 * @param {{store: object}} deps
 * @returns {Promise<object[]>} the sections in order
 */
export async function list({ store }) {
  const manuscript = await loadManuscript(store);
  return [...manuscript.sections].sort((a, b) => a.order - b.order);
}

/**
 * @param {{store: object}} deps
 * @param {string} section
 * @returns {Promise<object>} the section entry plus its body and its last report
 */
export async function show({ store }, section) {
  const manuscript = await loadManuscript(store);
  const entry = findSection(manuscript, section);
  const text = entry.status === 'planned' ? null : await store.readSection(entry.file);
  return {
    ...entry,
    body: text === null ? null : parseSectionFile(text).body,
    report: await store.readReport(entry.id),
  };
}

/**
 * @param {{store: object}} deps
 * @returns {Promise<{title: string, language: string, voice: object,
 *   counts: object, sections: object[]}>}
 */
export async function status({ store }) {
  const manuscript = await loadManuscript(store);
  const counts = { planned: 0, draft: 0, revised: 0, approved: 0 };
  for (const entry of manuscript.sections) counts[entry.status] += 1;
  return {
    title: manuscript.title,
    language: manuscript.language,
    voice: manuscript.voice,
    counts,
    sections: [...manuscript.sections].sort((a, b) => a.order - b.order),
  };
}

/**
 * Runs the deterministic gates over a draft and, only if nothing blocks, records it as the
 * section: the file with its front matter, the manuscript entry (status and hash), the report,
 * and one event. A block writes nothing at all (spec §3.4).
 * @param {{store: object, clock: () => string, actor: object,
 *   readText: (path: string) => Promise<string|null>}} deps
 * @param {{section: string, file: string, revision?: boolean, gates?: object[]}} input
 * @returns {Promise<{section: object, findings: object[], report: object, path: string}>}
 */
export async function submit(
  { store, clock, actor, readText },
  { section, file, revision = false, gates = DEFAULT_GATES } = {},
) {
  assertUpToDate(await store.readProject());

  const manuscript = await loadManuscript(store);
  const entry = findSection(manuscript, section);

  if (!file) {
    throw new PhdudeError(
      'USAGE',
      'manuscript submit needs --file',
      `phdude manuscript submit ${entry.id} --file <draft.md>`,
      null,
    );
  }

  if (entry.status === 'approved') {
    throw new PhdudeError(
      'POLICY',
      `section ${entry.id} is approved; approved text is not overwritten`,
      `phdude manuscript reopen ${entry.id}, then submit the revision`,
      null,
    );
  }

  const target = revision ? 'revised' : 'draft';
  // Re-submitting a draft that is still a draft is the same state, not a transition, which is
  // why `canTransition` alone would refuse it.
  if (entry.status !== target && !canTransition(entry.status, target)) {
    throw new PhdudeError(
      'POLICY',
      `cannot move section ${entry.id} from ${entry.status} to ${target}`,
      target === 'revised'
        ? `a ${entry.status} section has no draft to revise; submit it without --revision first`
        : `phdude manuscript submit ${entry.id} --file <draft.md> --revision`,
      null,
    );
  }

  const draft = await readText(file);
  if (draft === null) {
    throw new PhdudeError('USAGE', `cannot read ${file}`, 'pass the path to the draft', null);
  }

  const body = parseSectionFile(draft).body;
  const { findings, blocked, gates: rows } = runGates(body, await gateContext(store), { gates });

  if (blocked) {
    const blocking = rows.filter((row) => row.blocked).map((row) => row.gate);
    const blocks = findings.filter((finding) => finding.severity === 'block');
    throw new PhdudeError(
      'VALIDATION',
      `section blocked by ${blocking.join(', ')}: ${blocks.length} finding(s)`,
      'fix the findings above in the draft, then submit it again',
      findings.map(formatFinding),
    );
  }

  const at = clock();
  const hash = sectionHash(body);
  const path = await store.writeSection(
    entry.file,
    renderSectionFile({ section: entry.id, status: target, hash, updated: at }, body),
  );
  await store.writeManuscript(withSection(manuscript, entry.id, { status: target, hash }));

  const report = {
    schema: 'phdude.section-report',
    version: 1,
    section: entry.id,
    hash,
    at,
    gates: rows,
    scores: {},
    warnings: findings.filter((finding) => finding.severity === 'warn').length,
    blocks: 0,
  };
  await store.writeReport(entry.id, report);

  await store.appendEvent({
    ts: at,
    op: 'manuscript',
    actor,
    ids: [],
    summary: `submitted ${entry.id} (${target})`,
  });

  return { section: { ...entry, status: target, hash }, findings, report, path };
}

/**
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {{section: string, decision: string}} input
 * @returns {Promise<{section: object, decision: string}>}
 */
export async function approve({ store, clock, actor }, { section, decision } = {}) {
  assertUpToDate(await store.readProject());

  const manuscript = await loadManuscript(store);
  const entry = findSection(manuscript, section);
  await requireApprovingDecision(store, entry.id, decision);

  if (entry.status === 'approved' && entry.approved_by === decision) {
    return { section: entry, decision };
  }

  if (!canTransition(entry.status, 'approved')) {
    throw new PhdudeError(
      'POLICY',
      `cannot approve a ${entry.status} section: ${entry.id}`,
      entry.status === 'planned'
        ? `phdude manuscript submit ${entry.id} --file <draft.md> first`
        : `${entry.id} is already approved`,
      null,
    );
  }

  const approved = { ...entry, status: 'approved', approved_by: decision };
  await store.writeManuscript(
    withSection(manuscript, entry.id, { status: 'approved', approved_by: decision }),
  );
  await store.appendEvent({
    ts: clock(),
    op: 'manuscript',
    actor,
    ids: [decision],
    summary: `approved ${entry.id} (${decision})`,
  });
  return { section: approved, decision };
}

/**
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {{section: string}} input
 * @returns {Promise<{section: object}>}
 */
export async function reopen({ store, clock, actor }, { section } = {}) {
  assertUpToDate(await store.readProject());

  const manuscript = await loadManuscript(store);
  const entry = findSection(manuscript, section);

  if (entry.status !== 'approved') {
    throw new PhdudeError(
      'POLICY',
      `section ${entry.id} is not approved, so there is nothing to reopen`,
      `it is ${entry.status}`,
      null,
    );
  }

  const reopened = { ...withoutApproval(entry), status: 'revised' };
  await store.writeManuscript({
    ...manuscript,
    sections: manuscript.sections.map((s) => (s.id === entry.id ? reopened : s)),
  });
  await store.appendEvent({
    ts: clock(),
    op: 'manuscript',
    actor,
    ids: [],
    summary: `reopened ${entry.id} (revised)`,
  });
  return { section: reopened };
}

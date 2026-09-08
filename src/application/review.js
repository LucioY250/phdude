import { DEFAULT_BUDGET_CHARS, assembleReviewContext } from '../domain/context-budget.js';
import { newReview } from '../domain/entities.js';
import { PhdudeError } from '../domain/errors.js';
import {
  REVIEW_KINDS,
  REVIEW_STATUSES,
  canTransition,
  nextStatuses,
  validateFindings,
} from '../domain/reviews.js';
import { REVIEW_MODES } from './mode.js';
import { assertUpToDate } from './guard.js';
import { loadSnapshot } from './snapshot.js';

// `phdude review <kind>` (spec §3.2) hands a reviewer a bounded view of what the workspace
// records and the contract it has to answer in. It writes cache and records no event: the
// review is the agent's, and nothing is recorded until `review submit` turns a findings file
// into REVIEW objects the researcher can accept, dismiss or resolve.

// What the reviewer owes back. Printed with the context path, because a context with no
// contract is an invitation to say whatever sounds severe.
export const FINDINGS_CONTRACT = [
  'Answer as JSON: {"findings": [{"target": "…", "severity": "…", "message": "…", "evidence": ["…"]}]}.',
  'target is an object id the context lists, manuscript:<section>, or project.',
  'severity is block, major, minor or note - block means the work cannot go out as it stands.',
  'evidence lists the ids the finding rests on. A finding you cannot attach to a recorded id is a question for the researcher, not a finding.',
  'suggested_command is optional: the command that would fix it.',
  'Do not repeat a finding the context already lists as recorded, and add nothing the context does not carry.',
];

function contractFor(kind) {
  return [
    ...FINDINGS_CONTRACT,
    `Submit it with: phdude review submit --file <findings.json> --kind ${kind}`,
  ];
}

function assertKind(kind) {
  if (!REVIEW_KINDS.includes(kind)) {
    throw new PhdudeError(
      'USAGE',
      `unknown review kind: ${kind ?? '(none)'}`,
      `valid kinds: ${REVIEW_KINDS.join(', ')}`,
    );
  }
  return kind;
}

function parseBudget(budget) {
  if (budget === undefined || budget === null || budget === '') return DEFAULT_BUDGET_CHARS;
  const value = Number(budget);
  if (!Number.isInteger(value) || value <= 0) {
    throw new PhdudeError(
      'VALIDATION',
      `invalid budget: ${budget}`,
      '--budget takes a positive number of characters',
    );
  }
  return value;
}

// Every id the workspace records, and every manuscript section: what a finding may name.
function knownFrom(snapshot) {
  return {
    ids: new Set(snapshot.graph.nodes.keys()),
    sections: new Set((snapshot.manuscript?.sections ?? []).map((section) => section.id)),
  };
}

/**
 * @param {{store: object, clock?: () => string}} deps
 * @param {{kind: string, target?: string, budget?: string|number}} input
 * @returns {Promise<{kind: string, target: object, path: string, markdown: string,
 *   included: object[], truncated: object[], budget: number, contract: string[]}>}
 */
export async function context({ store, clock }, { kind, target = 'project', budget } = {}) {
  assertKind(kind);
  const budgetChars = parseBudget(budget);

  const snapshot = await loadSnapshot(store, clock);
  assertUpToDate(snapshot.project);

  const assembled = assembleReviewContext(snapshot, { kind, target, budgetChars });
  if (assembled === null) {
    throw new PhdudeError(
      'USAGE',
      `unknown review target: ${target}`,
      'a target is an object id, manuscript:<section>, or project',
    );
  }

  const path = await store.writeReviewContext(kind, assembled.markdown);

  return {
    kind,
    target: assembled.target,
    path,
    markdown: assembled.markdown,
    included: assembled.included,
    truncated: assembled.truncated,
    budget: budgetChars,
    contract: contractFor(kind),
  };
}

async function readFindings(readText, file) {
  if (typeof file !== 'string' || file.trim() === '') {
    throw new PhdudeError(
      'USAGE',
      'review submit needs a findings file',
      'phdude review submit --file <findings.json> [--kind <kind>]',
    );
  }
  const text = await readText(file);
  if (text === null) {
    throw new PhdudeError('USAGE', `not found: ${file}`, 'pass the path to the findings JSON file');
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new PhdudeError(
      'VALIDATION',
      `${file} is not valid JSON: ${err.message}`,
      'the findings file holds one JSON object: {"findings": [ … ]}',
    );
  }
}

/**
 * Records a findings file as REVIEW objects. A finding already recorded - the same kind, target
 * and message - is left exactly as it is, verdict included: re-running a review must not reopen
 * a finding the researcher already dismissed.
 * @param {{store: object, clock: () => string, actor: object, readText: (path: string) => Promise<string|null>}} deps
 * @param {{file: string, kind?: string}} input
 * @returns {Promise<{kind: string, mode: string, created: object[], existing: object[]}>}
 */
export async function submit({ store, clock, actor, readText }, { file, kind } = {}) {
  const payload = await readFindings(readText, file);
  const chosen = assertKind(kind ?? payload?.kind ?? 'custom');

  const snapshot = await loadSnapshot(store, clock);
  assertUpToDate(snapshot.project);

  const findings = validateFindings(payload, knownFrom(snapshot));
  // The mode the review ran under is part of what it said: a `ruthless` finding and a `lite`
  // one carry different weight, and a mode changed later must not rewrite that history.
  const mode = REVIEW_MODES.includes(snapshot.project?.mode) ? snapshot.project.mode : 'full';

  const created = [];
  const existing = [];
  for (const finding of findings) {
    const candidate = newReview({
      ...finding,
      kind: chosen,
      by: actor,
      mode,
      actor,
      created: clock(),
    });
    const already = await store.readEntity(candidate.id);
    if (already) {
      existing.push(already);
      continue;
    }
    await store.writeEntity(candidate);
    created.push(candidate);
  }

  if (created.length > 0) {
    await store.appendEvent({
      ts: clock(),
      op: 'review',
      actor,
      ids: created.map((review) => review.id),
      summary:
        `${chosen} review: ${created.length} finding(s) recorded` +
        (existing.length > 0 ? `, ${existing.length} already recorded` : ''),
    });
  }

  return { kind: chosen, mode, created, existing };
}

/**
 * @param {{store: object}} deps
 * @param {{status?: string, kind?: string}} [opts]
 * @returns {Promise<object[]>}
 */
export async function list({ store }, { status, kind } = {}) {
  if (status !== undefined && !REVIEW_STATUSES.includes(status)) {
    throw new PhdudeError(
      'USAGE',
      `unknown status: ${status}`,
      `valid statuses: ${REVIEW_STATUSES.join(', ')}`,
    );
  }
  if (kind !== undefined) assertKind(kind);

  const reviews = await store.listEntities('review');
  return reviews.filter(
    (review) =>
      (status === undefined || review.status === status) &&
      (kind === undefined || review.kind === kind),
  );
}

async function getReview(store, id) {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new PhdudeError('USAGE', 'this command needs a review id', 'phdude review list');
  }
  const obj = await store.readEntity(id);
  if (!obj || obj.schema !== 'phdude.review') {
    throw new PhdudeError('USAGE', `not found: ${id}`, 'run phdude review list');
  }
  return obj;
}

/**
 * @param {{store: object}} deps
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function show({ store }, id) {
  return getReview(store, id);
}

// Terminal statuses close a finding, so they carry when it was closed the way a decision does.
const CLOSING = ['dismissed', 'resolved'];

async function transition({ store, clock, actor }, id, to, { reason } = {}) {
  assertUpToDate(await store.readProject());

  const review = await getReview(store, id);
  if (review.status === to) return { review, changed: false };

  if (!canTransition(review.status, to)) {
    const allowed = nextStatuses(review.status);
    throw new PhdudeError(
      'VALIDATION',
      `cannot move ${id} from ${review.status} to ${to}`,
      allowed.length === 0
        ? `${id} is ${review.status}; a closed finding stays closed`
        : `${id} is ${review.status}; it can only become ${allowed.join(' or ')}`,
    );
  }

  const updated = { ...review, status: to };
  if (CLOSING.includes(to)) updated.resolved = clock();
  const trimmed = String(reason ?? '').trim();
  if (trimmed !== '') updated.reason = trimmed;

  await store.writeEntity(updated);
  await store.appendEvent({
    ts: clock(),
    op: 'review',
    actor,
    ids: [id],
    summary: `${id} ${review.status} → ${to}`,
  });
  return { review: updated, changed: true };
}

/**
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {string} id
 * @param {{reason?: string}} [opts]
 * @returns {Promise<{review: object, changed: boolean}>}
 */
export async function accept(deps, id, { reason } = {}) {
  return transition(deps, id, 'accepted', { reason });
}

/**
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {string} id
 * @param {{reason?: string}} [opts]
 * @returns {Promise<{review: object, changed: boolean}>}
 */
export async function dismiss(deps, id, { reason } = {}) {
  return transition(deps, id, 'dismissed', { reason });
}

/**
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {string} id
 * @param {{reason?: string}} [opts]
 * @returns {Promise<{review: object, changed: boolean}>}
 */
export async function resolve(deps, id, { reason } = {}) {
  return transition(deps, id, 'resolved', { reason });
}

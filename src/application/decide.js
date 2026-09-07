import { newDecision } from '../domain/entities.js';
import { PhdudeError } from '../domain/errors.js';
import { KNOWLEDGE_STATES, canTransition } from '../domain/states.js';

async function assertReferenceExists(store, id) {
  const obj = await store.readEntity(id);
  if (!obj) {
    throw new PhdudeError('VALIDATION', `unknown reference ${id}`, 'run phdude knowledge list');
  }
  return obj;
}

async function getDecision(store, id) {
  const obj = await store.readEntity(id);
  if (!obj || obj.schema !== 'phdude.decision') {
    throw new PhdudeError(
      'USAGE',
      `not found: ${id}`,
      'run phdude knowledge list --type decision',
      null,
    );
  }
  return obj;
}

// Approvals and rejections are recorded against a named human, never against the agent's
// resolved actor: a decision the researcher did not make must not carry their name.
function requireBy(by, verb, noun) {
  const trimmed = String(by ?? '').trim();
  if (!trimmed) {
    throw new PhdudeError(
      'USAGE',
      `"--by <researcher>" is required: ${noun} are recorded against a named researcher`,
      `phdude decide ${verb} <DEC-id> --by <your-name>`,
      null,
    );
  }
  return trimmed;
}

/**
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {{title: string, rationale: string, affects?: string[], change?: object}} input
 * @returns {Promise<{obj: object, created: boolean}>}
 */
export async function propose(
  { store, clock, actor },
  { title, rationale, affects = [], change = {} },
) {
  for (const id of affects) await assertReferenceExists(store, id);

  const candidate = newDecision({
    title,
    rationale,
    proposed_by: actor,
    affects,
    change,
    created: clock(),
  });

  const existing = await store.readEntity(candidate.id);
  if (existing) return { obj: existing, created: false };

  await store.writeEntity(candidate);
  await store.appendEvent({
    ts: clock(),
    op: 'decide',
    actor,
    ids: [candidate.id],
    summary: 'decision proposed',
  });
  return { obj: candidate, created: true };
}

/**
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {string} id
 * @param {{by: string}} opts
 * @returns {Promise<object>}
 */
export async function approve({ store, clock, actor }, id, { by } = {}) {
  const approver = requireBy(by, 'approve', 'approvals');
  const decision = await getDecision(store, id);

  if (decision.status === 'rejected' || decision.status === 'superseded') {
    throw new PhdudeError(
      'POLICY',
      `cannot approve decision ${id} with status ${decision.status}`,
      null,
      null,
    );
  }

  const alreadyApproved = decision.approved_by.includes(approver);
  if (decision.status === 'approved' && alreadyApproved) {
    return decision;
  }

  const updated = {
    ...decision,
    status: 'approved',
    approved_by: alreadyApproved ? decision.approved_by : [...decision.approved_by, approver],
    resolved: clock(),
  };
  await store.writeEntity(updated);
  await store.appendEvent({
    ts: clock(),
    op: 'decide',
    actor,
    ids: [id],
    summary: `decision approved by ${approver}`,
  });
  return updated;
}

/**
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {string} id
 * @param {{by: string, reason?: string}} opts
 * @returns {Promise<object>}
 */
export async function reject({ store, clock, actor }, id, { by, reason } = {}) {
  const rejector = requireBy(by, 'reject', 'rejections');
  const decision = await getDecision(store, id);

  if (decision.status === 'approved') {
    throw new PhdudeError(
      'POLICY',
      `cannot reject an approved decision ${id}`,
      'supersede it instead',
      null,
    );
  }

  const updated = {
    ...decision,
    status: 'rejected',
    resolved: clock(),
    change: { ...decision.change, rejection_reason: reason },
  };
  await store.writeEntity(updated);
  await store.appendEvent({
    ts: clock(),
    op: 'decide',
    actor,
    ids: [id],
    summary: `decision rejected by ${rejector}`,
  });
  return updated;
}

/**
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {string} id
 * @param {{by: string}} opts - `by` is the id of the superseding decision
 * @returns {Promise<object>}
 */
export async function supersede({ store, clock, actor }, id, { by } = {}) {
  const newDecisionId = by;
  if (newDecisionId === id) {
    throw new PhdudeError('USAGE', 'a decision cannot supersede itself', null, null);
  }
  const decision = await getDecision(store, id);
  await getDecision(store, newDecisionId);

  const updated = {
    ...decision,
    status: 'superseded',
    resolved: clock(),
    change: { ...decision.change, superseded_by: newDecisionId },
  };
  await store.writeEntity(updated);
  await store.appendEvent({
    ts: clock(),
    op: 'decide',
    actor,
    ids: [id, newDecisionId],
    summary: `decision ${id} superseded by ${newDecisionId}`,
  });
  return updated;
}

/**
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {string} id
 * @param {{to?: string, decision?: string}} opts
 * @returns {Promise<object>}
 */
export async function promote({ store, clock, actor }, id, { to = 'canonical', decision } = {}) {
  if (!KNOWLEDGE_STATES.includes(to)) {
    throw new PhdudeError(
      'USAGE',
      `unknown state: ${to}`,
      `valid states: ${KNOWLEDGE_STATES.join(', ')}`,
    );
  }

  const obj = await store.readEntity(id);
  if (!obj) throw new PhdudeError('USAGE', `not found: ${id}`, 'run phdude knowledge list', null);
  if (obj.state === undefined) {
    throw new PhdudeError(
      'USAGE',
      `${id} has no state to promote`,
      'only knowledge objects carry a state; artifacts and decisions do not',
      null,
    );
  }

  if (obj.state === to) return obj;

  if (!canTransition(obj.state, to)) {
    throw new PhdudeError('POLICY', `cannot move ${id} from ${obj.state} to ${to}`, null, null);
  }

  if (to === 'canonical') {
    const hint = `propose and approve a decision that affects ${id}`;
    if (!decision) {
      throw new PhdudeError(
        'POLICY',
        `promoting ${id} to canonical requires a decision`,
        hint,
        null,
      );
    }
    const decisionObj = await store.readEntity(decision);
    if (!decisionObj || decisionObj.schema !== 'phdude.decision') {
      throw new PhdudeError('POLICY', `unknown decision ${decision}`, hint, null);
    }
    if (decisionObj.status !== 'approved') {
      throw new PhdudeError('POLICY', `decision ${decision} is not approved`, hint, null);
    }
    if (!decisionObj.affects.includes(id)) {
      throw new PhdudeError('POLICY', `decision ${decision} does not affect ${id}`, hint, null);
    }
  }

  const from = obj.state;
  const updated = { ...obj, state: to };
  await store.writeEntity(updated);
  await store.appendEvent({
    ts: clock(),
    op: 'promote',
    actor,
    ids: [id, decision].filter(Boolean),
    summary: `${id} ${from} → ${to}`,
  });
  return updated;
}

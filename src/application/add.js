import {
  newClaim,
  newEvidence,
  newFact,
  newSource,
  newResult,
  newQuestion,
  newHypothesis,
} from '../domain/entities.js';
import { PhdudeError } from '../domain/errors.js';

const FACTORIES = {
  claim: newClaim,
  evidence: newEvidence,
  fact: newFact,
  source: newSource,
  result: newResult,
};

const SEQ_FACTORIES = {
  question: newQuestion,
  hypothesis: newHypothesis,
};

async function assertReferenceExists(store, id) {
  const obj = await store.readEntity(id);
  if (!obj) {
    throw new PhdudeError('VALIDATION', `unknown reference ${id}`, 'run phdude knowledge list');
  }
}

async function validateReferences(store, type, input) {
  if (type === 'claim') {
    for (const id of input.supported_by ?? []) await assertReferenceExists(store, id);
    for (const id of input.questions ?? []) await assertReferenceExists(store, id);
  } else if (type === 'evidence') {
    if (input.source !== undefined) await assertReferenceExists(store, input.source);
  } else if (type === 'fact') {
    if (input.from?.artifact !== undefined) await assertReferenceExists(store, input.from.artifact);
  } else if (type === 'source') {
    for (const id of input.artifacts ?? []) await assertReferenceExists(store, id);
  } else if (type === 'hypothesis') {
    for (const id of input.questions ?? []) await assertReferenceExists(store, id);
  }
}

async function nextSeq(store, type) {
  const existing = await store.listEntities(type);
  let max = 0;
  for (const obj of existing) {
    const m = /-(\d+)$/.exec(obj.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

async function addArtifactRole({ store, clock, actor }, { id, role }) {
  const existing = await store.readEntity(id);
  if (!existing) {
    throw new PhdudeError('VALIDATION', `unknown reference ${id}`, 'run phdude knowledge list');
  }
  const updated = { ...existing, role };
  await store.writeEntity(updated);
  await store.appendEvent({
    ts: clock(),
    op: 'add',
    actor,
    ids: [id],
    summary: `artifact role set to ${role}`,
  });
  return { obj: updated, created: false };
}

/**
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {string} type
 * @param {object} input
 * @returns {Promise<{obj: object, created: boolean}>}
 */
export async function addEntity({ store, clock, actor }, type, input) {
  if (type === 'decision') {
    throw new PhdudeError(
      'USAGE',
      'decisions cannot be added directly',
      'use phdude decide propose',
    );
  }

  if (type === 'artifact-role') {
    return addArtifactRole({ store, clock, actor }, input);
  }

  const factory = FACTORIES[type] ?? SEQ_FACTORIES[type];
  if (!factory) {
    throw new PhdudeError(
      'USAGE',
      `unknown entity type: ${type}`,
      'valid types: claim, evidence, fact, source, result, question, hypothesis, artifact-role',
    );
  }

  await validateReferences(store, type, input);

  if (SEQ_FACTORIES[type]) {
    const n = await nextSeq(store, type);
    const obj = factory({ ...input, n, actor, created: clock() });
    await store.writeEntity(obj);
    await store.appendEvent({
      ts: clock(),
      op: 'add',
      actor,
      ids: [obj.id],
      summary: `${type} added`,
    });
    return { obj, created: true };
  }

  const candidate = factory({ ...input, actor, created: clock() });
  const existing = await store.readEntity(candidate.id);
  if (existing) return { obj: existing, created: false };

  await store.writeEntity(candidate);
  await store.appendEvent({
    ts: clock(),
    op: 'add',
    actor,
    ids: [candidate.id],
    summary: `${type} added`,
  });
  return { obj: candidate, created: true };
}

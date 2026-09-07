import {
  newClaim,
  newEvidence,
  newFact,
  newMethod,
  newSource,
  newResult,
  newQuestion,
  newHypothesis,
} from '../domain/entities.js';
import { PhdudeError } from '../domain/errors.js';
import { parseId } from '../domain/ids.js';
import { normalizeText } from '../domain/normalize.js';
import { assertUpToDate } from './guard.js';

const FACTORIES = {
  claim: newClaim,
  evidence: newEvidence,
  fact: newFact,
  method: newMethod,
  source: newSource,
  result: newResult,
};

const SEQ_FACTORIES = {
  question: newQuestion,
  hypothesis: newHypothesis,
};

// The factories destructure known fields only, so without this a typo ("question" for
// "questions") passes validation, is silently dropped, and cannot be corrected afterwards
// because the id is already derived from the rest of the content.
export const ALLOWED_FIELDS = {
  claim: ['statement', 'kind', 'supported_by', 'questions', 'sections', 'tags', 'provenance'],
  evidence: ['source', 'locator', 'excerpt', 'strength', 'tags', 'provenance'],
  fact: ['key', 'value', 'unit', 'from', 'tags'],
  method: [
    'name',
    'design',
    'paradigm',
    'sampling',
    'instruments',
    'analysis',
    'limitations',
    'questions',
    'tags',
  ],
  source: [
    'title',
    'authors',
    'year',
    'venue',
    'doi',
    'url',
    'type',
    'artifacts',
    'tags',
    'bibkey',
    'abstract',
    'keywords',
    'identifiers',
  ],
  result: ['summary', 'from', 'values', 'tags'],
  question: ['text', 'objectives', 'tags'],
  hypothesis: ['text', 'questions', 'tags'],
  'artifact-role': ['id', 'role'],
};

function assertKnownFields(type, input) {
  const allowed = ALLOWED_FIELDS[type];
  const unknown = Object.keys(input ?? {})
    .filter((key) => !allowed.includes(key))
    .sort();
  if (unknown.length > 0) {
    throw new PhdudeError(
      'VALIDATION',
      `unknown field(s) for ${type}: ${unknown.join(', ')}`,
      `allowed: ${allowed.join(', ')}`,
    );
  }
}

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
  } else if (type === 'hypothesis' || type === 'method') {
    for (const id of input.questions ?? []) await assertReferenceExists(store, id);
  }
}

// What the record was read out of, resolved from what it already references: evidence points
// at the artifact it was read from (directly, or through its source's artifacts), and a claim
// inherits the union from the evidence it cites. Computed here rather than in the factory
// because only the application layer can read the referenced objects back.
async function derivedFrom(store, type, input) {
  if (type === 'evidence') {
    if (input.source === undefined) return [];
    if (parseId(input.source)?.type === 'artifact') return [input.source];
    const source = await store.readEntity(input.source);
    return [...new Set(source?.artifacts ?? [])].sort();
  }
  if (type === 'claim') {
    const ids = new Set();
    for (const id of input.supported_by ?? []) {
      const evidence = await store.readEntity(id);
      for (const derived of evidence?.provenance?.derived_from ?? []) ids.add(derived);
    }
    return [...ids].sort();
  }
  return [];
}

function nextSeq(existing) {
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
  if (existing.role === role) return { obj: existing, created: false, updated: false };

  const updated = { ...existing, role };
  await store.writeEntity(updated);
  await store.appendEvent({
    ts: clock(),
    op: 'add',
    actor,
    ids: [id],
    summary: `artifact role set to ${role}`,
  });
  return { obj: updated, created: false, updated: true };
}

/**
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {string} type
 * @param {object} input
 * @returns {Promise<{obj: object, created: boolean, updated?: boolean}>} `updated` is reported
 *   by `artifact-role`, the one type that changes an object instead of creating one
 */
export async function addEntity({ store, clock, actor }, type, input) {
  assertUpToDate(await store.readProject());

  if (type === 'decision') {
    throw new PhdudeError(
      'USAGE',
      'decisions cannot be added directly',
      'use phdude decide propose',
    );
  }

  if (!ALLOWED_FIELDS[type]) {
    throw new PhdudeError(
      'USAGE',
      `unknown entity type: ${type}`,
      'valid types: claim, evidence, fact, method, source, result, question, hypothesis, artifact-role',
    );
  }
  assertKnownFields(type, input);

  if (type === 'artifact-role') {
    return addArtifactRole({ store, clock, actor }, input);
  }

  const factory = FACTORIES[type] ?? SEQ_FACTORIES[type];
  await validateReferences(store, type, input);

  if (SEQ_FACTORIES[type]) {
    // Sequential ids cannot dedupe the way content-derived ones do, so re-running the
    // bootstrap skill would mint a second RQ for a question already recorded. Match on the
    // normalized text instead, and keep the documented "adding twice is a no-op" contract.
    const existing = await store.listEntities(type);
    const wanted = normalizeText(input.text ?? '');
    const duplicate = existing.find((obj) => normalizeText(obj.text) === wanted);
    if (duplicate) return { obj: duplicate, created: false };

    const n = nextSeq(existing);
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

  const candidate = factory({
    ...input,
    derived_from: await derivedFrom(store, type, input),
    actor,
    created: clock(),
  });
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

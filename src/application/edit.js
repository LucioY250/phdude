import { PhdudeError } from '../domain/errors.js';
import { parseId } from '../domain/ids.js';
import { assertUpToDate } from './guard.js';

// What identifies each kind of object. Ids are derived from these (ADR 0003), so changing one
// would mean a different object wearing the old object's id - every reference to it would
// silently point at something else. Correcting an identity field is `phdude add` again: the
// new content mints a new record and the old one stays as the history of what was believed.
const IDENTITY_FIELDS = {
  claim: ['statement'],
  evidence: ['source', 'locator', 'excerpt'],
  fact: ['key', 'value', 'from'],
  source: ['title', 'year'],
  result: ['summary', 'from'],
  decision: ['title', 'rationale', 'affects', 'change'],
  method: ['name'],
  question: ['text'],
  hypothesis: ['text'],
  artifact: [],
};

// Everything else the researcher may correct in place. `state` is deliberately absent from
// every list: moving an object between states is `phdude promote`, which is where the state
// machine and the approved-Decision requirement live. So are the fields other commands own -
// a claim's `contradicts` (recorded by `phdude link`), a decision's `status` and
// `approved_by` (`phdude decide`), and an artifact's inventory fields (`phdude ingest`).
const EDITABLE_FIELDS = {
  claim: ['kind', 'supported_by', 'questions', 'sections', 'provenance', 'tags'],
  evidence: ['strength', 'provenance', 'tags'],
  fact: ['unit', 'tags'],
  source: [
    'authors',
    'venue',
    'doi',
    'url',
    'type',
    'artifacts',
    'bibkey',
    'abstract',
    'keywords',
    'identifiers',
    'provenance',
    'tags',
  ],
  result: ['values', 'tags'],
  decision: ['tags'],
  method: [
    'design',
    'paradigm',
    'sampling',
    'instruments',
    'analysis',
    'limitations',
    'questions',
    'tags',
  ],
  question: ['objectives', 'tags'],
  hypothesis: ['questions', 'tags'],
  artifact: ['role', 'tags'],
};

function assertEditableType(type, id) {
  if (type === 'candidate') {
    throw new PhdudeError(
      'USAGE',
      'candidates are not edited, they are reviewed',
      `phdude research accept ${id} or phdude research dismiss ${id} --reason "…"`,
    );
  }
  if (!EDITABLE_FIELDS[type]) {
    throw new PhdudeError(
      'USAGE',
      `${type} objects cannot be edited`,
      `editable types: ${Object.keys(EDITABLE_FIELDS).sort().join(', ')}`,
    );
  }
}

function assertEditableFields(type, fields) {
  const names = Object.keys(fields);
  if (names.length === 0) {
    throw new PhdudeError(
      'USAGE',
      'edit needs at least one field',
      `phdude edit <id> --json '{"tags":["…"]}'`,
    );
  }

  const identity = names.filter((name) => IDENTITY_FIELDS[type].includes(name)).sort();
  if (identity.length > 0) {
    throw new PhdudeError(
      'VALIDATION',
      `cannot edit the identity field(s) of a ${type}: ${identity.join(', ')}`,
      `a ${type}'s id is derived from ${IDENTITY_FIELDS[type].join(', ')} - add a corrected object with phdude add instead`,
    );
  }

  const unknown = names.filter((name) => !EDITABLE_FIELDS[type].includes(name)).sort();
  if (unknown.length > 0) {
    throw new PhdudeError(
      'VALIDATION',
      `unknown field(s) for ${type}: ${unknown.join(', ')}`,
      `editable: ${EDITABLE_FIELDS[type].join(', ')}`,
    );
  }
}

/**
 * Corrects the non-identity fields of a recorded object in place (spec §3.4, v0.2 backlog).
 * The three guards are the whole point of the command: a canonical object is the researcher's,
 * an identity field cannot change without changing the object, and a field the schema does not
 * know is a typo rather than a new field.
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {string} id
 * @param {object} fields
 * @returns {Promise<object>} the updated object
 */
export async function edit({ store, clock, actor }, id, fields = {}) {
  assertUpToDate(await store.readProject());

  const type = parseId(id)?.type;
  if (!type) {
    throw new PhdudeError('USAGE', `not an object id: ${id}`, 'ids look like CLAIM-<10 hex>');
  }
  assertEditableType(type, id);

  const obj = await store.readEntity(id);
  if (!obj) {
    throw new PhdudeError('USAGE', `not found: ${id}`, 'run phdude knowledge list');
  }
  if (obj.state === 'canonical') {
    throw new PhdudeError(
      'POLICY',
      `${id} is canonical and cannot be edited`,
      'propose a Decision with phdude decide propose; canonical knowledge belongs to the researcher',
    );
  }

  assertEditableFields(type, fields);

  const updated = { ...obj, ...fields };
  // The store validates against the schema before it writes, so a value of the wrong shape is
  // a VALIDATION error naming the field rather than a corrupted file on disk.
  await store.writeEntity(updated);

  const at = clock();
  await store.appendEvent({
    ts: at,
    op: 'edit',
    actor,
    ids: [id],
    summary: `edited ${id}: ${Object.keys(fields).sort().join(', ')}`,
  });

  return updated;
}

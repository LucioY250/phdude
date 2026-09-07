import { PhdudeError } from '../domain/errors.js';
import { parseId } from '../domain/ids.js';
import { assertUpToDate } from './guard.js';

// Which target type each linkable object accepts, and the field the link lands in. Anything
// absent here has no v0.1 link relation: the way to change it is a Decision.
const LINKABLE = {
  'phdude.claim': { evidence: 'supported_by', question: 'questions' },
  'phdude.hypothesis': { question: 'questions' },
  'phdude.source': { artifact: 'artifacts' },
};

const RELATION_HINT =
  'linkable relations: claim → evidence, claim → question, hypothesis → question, source → artifact';

/**
 * Attaches existing objects to an existing object, the one edit `phdude add` cannot make
 * because content-derived ids turn a re-add into a no-op. Additive only: it appends ids to a
 * relation field, never removes or replaces one.
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {string} id
 * @param {{to?: string[]}} opts
 * @returns {Promise<{obj: object, added: string[]}>}
 */
export async function link({ store, clock, actor }, id, { to = [] } = {}) {
  assertUpToDate(await store.readProject());

  if (to.length === 0) {
    throw new PhdudeError('USAGE', 'link needs at least one target', 'phdude link <id> --to <id>');
  }

  const obj = await store.readEntity(id);
  if (!obj) throw new PhdudeError('USAGE', `not found: ${id}`, 'run phdude knowledge list');

  const relations = LINKABLE[obj.schema];
  if (!relations) {
    throw new PhdudeError('VALIDATION', `cannot link from ${id}`, RELATION_HINT);
  }
  if (obj.state === 'canonical') {
    throw new PhdudeError(
      'POLICY',
      `cannot link ${id}: it is canonical`,
      'canonical objects change only through a decision; propose one',
    );
  }

  const updated = { ...obj };
  const added = [];

  for (const targetId of to) {
    const target = await store.readEntity(targetId);
    if (!target) {
      throw new PhdudeError(
        'VALIDATION',
        `unknown reference ${targetId}`,
        'run phdude knowledge list',
      );
    }
    const field = relations[parseId(targetId)?.type];
    if (!field) {
      throw new PhdudeError('VALIDATION', `cannot link ${id} to ${targetId}`, RELATION_HINT);
    }
    const current = updated[field] ?? [];
    if (current.includes(targetId)) continue;
    updated[field] = [...current, targetId];
    added.push(targetId);
  }

  if (added.length === 0) return { obj, added };

  await store.writeEntity(updated);
  await store.appendEvent({
    ts: clock(),
    op: 'link',
    actor,
    ids: [id, ...added],
    summary: `${id} linked to ${added.length} object(s)`,
  });
  return { obj: updated, added };
}

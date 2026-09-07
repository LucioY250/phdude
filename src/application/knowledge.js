import { PhdudeError } from '../domain/errors.js';
import { trace as traceGraph } from '../domain/lineage.js';
import { KNOWLEDGE_STATES } from '../domain/states.js';
import { loadSnapshot } from './snapshot.js';

const COLLECTION_BY_TYPE = {
  artifact: 'artifacts',
  source: 'sources',
  claim: 'claims',
  evidence: 'evidence',
  fact: 'facts',
  result: 'results',
  question: 'questions',
  hypothesis: 'hypotheses',
  method: 'methods',
  decision: 'decisions',
};

function primaryText(obj) {
  if (obj.statement !== undefined) return String(obj.statement);
  if (obj.excerpt !== undefined) return String(obj.excerpt);
  if (obj.key !== undefined) return `${obj.key} ${obj.value}`;
  if (obj.title !== undefined) return String(obj.title);
  if (obj.summary !== undefined) return String(obj.summary);
  if (obj.text !== undefined) return String(obj.text);
  if (obj.name !== undefined) return String(obj.name);
  if (obj.path !== undefined) return String(obj.path);
  return '';
}

function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * @param {{store: object}} deps
 * @param {{type?: string, state?: string, query?: string}} [opts]
 * @returns {Promise<object[]>}
 */
export async function list({ store }, { type, state, query } = {}) {
  if (type !== undefined && COLLECTION_BY_TYPE[type] === undefined) {
    throw new PhdudeError(
      'USAGE',
      `unknown type: ${type}`,
      `valid types: ${Object.keys(COLLECTION_BY_TYPE).join(', ')}`,
    );
  }
  if (state !== undefined && !KNOWLEDGE_STATES.includes(state)) {
    throw new PhdudeError(
      'USAGE',
      `unknown state: ${state}`,
      `valid states: ${KNOWLEDGE_STATES.join(', ')}`,
    );
  }

  const snapshot = await loadSnapshot(store);
  let objs = type
    ? (snapshot[COLLECTION_BY_TYPE[type]] ?? [])
    : Object.values(COLLECTION_BY_TYPE).flatMap((key) => snapshot[key]);

  if (state) objs = objs.filter((o) => o.state === state);
  if (query) {
    const q = query.toLowerCase();
    objs = objs.filter((o) => primaryText(o).toLowerCase().includes(q));
  }

  return [...objs].sort(byId);
}

/**
 * @param {{store: object}} deps
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function show({ store }, id) {
  const obj = await store.readEntity(id);
  if (!obj) throw new PhdudeError('USAGE', `not found: ${id}`, 'run phdude knowledge list');
  return obj;
}

/**
 * @param {{store: object}} deps
 * @param {string} id
 * @returns {Promise<{id: string, obj: object|null, up: object[], down: object[]}>}
 */
export async function trace({ store }, id) {
  const snapshot = await loadSnapshot(store);
  const { up, down } = traceGraph(snapshot.graph, id);
  const resolve = (ids) => ids.map((i) => snapshot.graph.nodes.get(i)).filter(Boolean);
  // The traced object itself, so the renderer can report its provenance beside its lineage.
  return { id, obj: snapshot.graph.nodes.get(id) ?? null, up: resolve(up), down: resolve(down) };
}

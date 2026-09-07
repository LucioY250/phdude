import { PhdudeError } from '../domain/errors.js';
import { trace as traceGraph } from '../domain/lineage.js';
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
  decision: 'decisions',
};

function primaryText(obj) {
  if (obj.statement !== undefined) return String(obj.statement);
  if (obj.excerpt !== undefined) return String(obj.excerpt);
  if (obj.key !== undefined) return `${obj.key} ${obj.value}`;
  if (obj.title !== undefined) return String(obj.title);
  if (obj.summary !== undefined) return String(obj.summary);
  if (obj.text !== undefined) return String(obj.text);
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
  if (!obj) throw new PhdudeError('USAGE', `not found: ${id}`);
  return obj;
}

/**
 * @param {{store: object}} deps
 * @param {string} id
 * @returns {Promise<{id: string, up: object[], down: object[]}>}
 */
export async function trace({ store }, id) {
  const snapshot = await loadSnapshot(store);
  const { up, down } = traceGraph(snapshot.graph, id);
  const resolve = (ids) => ids.map((i) => snapshot.graph.nodes.get(i)).filter(Boolean);
  return { id, up: resolve(up), down: resolve(down) };
}

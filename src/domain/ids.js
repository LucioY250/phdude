import { sha256 } from './hash.js';
import { normalizeText } from './normalize.js';
export const ID_PREFIXES = {
  artifact: 'ART',
  source: 'SRC',
  claim: 'CLAIM',
  evidence: 'EVID',
  fact: 'FACT',
  result: 'RESULT',
  decision: 'DEC',
  question: 'RQ',
  hypothesis: 'H',
  method: 'METH',
};
const BY_PREFIX = Object.fromEntries(Object.entries(ID_PREFIXES).map(([t, p]) => [p, t]));
export function makeId(type, input) {
  const prefix = ID_PREFIXES[type];
  if (!prefix) throw new Error(`unknown entity type: ${type}`);
  const material = typeof input === 'string' ? `${type}\n${normalizeText(input)}` : input;
  return `${prefix}-${sha256(material).slice(0, 10)}`;
}
export function makeSeqId(type, n) {
  return `${ID_PREFIXES[type]}-${n}`;
}
export function parseId(id) {
  const m = /^([A-Z]+)-([0-9a-z]+)$/.exec(String(id));
  if (!m || !BY_PREFIX[m[1]]) return null;
  return { type: BY_PREFIX[m[1]], suffix: m[2] };
}

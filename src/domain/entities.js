import { makeId, makeSeqId } from './ids.js';
import { normalizeKey } from './normalize.js';
import { PhdudeError } from './errors.js';

function requireText(label, value) {
  const text = String(value ?? '').trim();
  if (!text) throw new PhdudeError('VALIDATION', `${label} must not be empty`, null, null);
  return text;
}

const ARTIFACT_MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  md: 'text/markdown',
  txt: 'text/plain',
  bib: 'application/x-bibtex',
  tex: 'application/x-tex',
  other: 'application/octet-stream',
};

export function mimeFor(kind) {
  return ARTIFACT_MIME[kind] ?? ARTIFACT_MIME.other;
}

/**
 * @param {object} p
 * @param {string} p.id
 * @param {string} p.path
 * @param {string} p.hash
 * @param {number} p.bytes
 * @param {string} p.kind
 * @param {string} p.mtime
 * @param {object} p.actor
 * @param {string} p.created
 * @returns {object} a schema-valid `phdude.artifact`
 */
export function newArtifact({ id, path, hash, bytes, kind, mtime, actor, created }) {
  return {
    schema: 'phdude.artifact',
    version: 1,
    id,
    created,
    actor,
    path,
    paths: [path],
    hash,
    bytes,
    mime: mimeFor(kind),
    kind,
    role: 'unknown',
    extracted: {
      status: 'unavailable',
      method: '',
      text_chars: 0,
      sections: 0,
      tables: 0,
      warnings: [],
    },
    mtime,
  };
}

/**
 * @param {object} p
 * @param {string} p.statement
 * @param {string} [p.kind]
 * @param {string[]} [p.supported_by]
 * @param {string[]} [p.questions]
 * @param {string[]} [p.sections]
 * @param {string[]} [p.tags]
 * @param {object} p.actor
 * @param {string} p.created
 * @returns {object} a schema-valid `phdude.claim`
 */
export function newClaim({
  statement,
  kind = 'empirical',
  supported_by = [],
  questions = [],
  sections = [],
  tags = [],
  actor,
  created,
}) {
  const text = requireText('statement', statement);
  return {
    schema: 'phdude.claim',
    version: 1,
    id: makeId('claim', text),
    created,
    actor,
    tags,
    statement: text,
    kind,
    state: 'candidate',
    supported_by,
    questions,
    sections,
  };
}

/**
 * @param {object} p
 * @param {string} p.source
 * @param {string} [p.locator]
 * @param {string} p.excerpt
 * @param {string} [p.strength]
 * @param {string[]} [p.tags]
 * @param {object} p.actor
 * @param {string} p.created
 * @returns {object} a schema-valid `phdude.evidence`
 */
export function newEvidence({
  source,
  locator = '',
  excerpt,
  strength = 'unknown',
  tags = [],
  actor,
  created,
}) {
  const text = requireText('excerpt', excerpt);
  return {
    schema: 'phdude.evidence',
    version: 1,
    id: makeId('evidence', text),
    created,
    actor,
    tags,
    source,
    locator,
    excerpt: text,
    strength,
    state: 'candidate',
  };
}

/**
 * @param {object} p
 * @param {string} p.key
 * @param {string|number|boolean} p.value
 * @param {string} [p.unit]
 * @param {{artifact: string, locator?: string}} p.from
 * @param {string[]} [p.tags]
 * @param {object} p.actor
 * @param {string} p.created
 * @returns {object} a schema-valid `phdude.fact`
 */
export function newFact({ key, value, unit, from, tags = [], actor, created }) {
  const rawKey = requireText('key', key);
  const normalizedKey = normalizeKey(rawKey);
  if (!normalizedKey) throw new PhdudeError('VALIDATION', 'key must not be empty', null, null);

  const from_ = { artifact: from?.artifact };
  if (from?.locator !== undefined) from_.locator = from.locator;

  const fact = {
    schema: 'phdude.fact',
    version: 1,
    id: makeId('fact', `${normalizedKey} ${value}`),
    created,
    actor,
    tags,
    key: normalizedKey,
    value,
    from: from_,
    state: 'candidate',
  };
  if (unit !== undefined) fact.unit = unit;
  return fact;
}

/**
 * @param {object} p
 * @param {string} p.title
 * @param {string[]} [p.authors]
 * @param {number} [p.year]
 * @param {string} [p.venue]
 * @param {string} [p.doi]
 * @param {string} [p.url]
 * @param {string} [p.type]
 * @param {string[]} [p.artifacts]
 * @param {string[]} [p.tags]
 * @param {object} p.actor
 * @param {string} p.created
 * @returns {object} a schema-valid `phdude.source`
 */
export function newSource({
  title,
  authors = [],
  year,
  venue,
  doi,
  url,
  type = 'article',
  artifacts = [],
  tags = [],
  actor,
  created,
}) {
  const text = requireText('title', title);
  const source = {
    schema: 'phdude.source',
    version: 1,
    id: makeId('source', `${text} ${year ?? ''}`),
    created,
    actor,
    tags,
    title: text,
    authors,
    type,
    artifacts,
    state: 'candidate',
  };
  if (year !== undefined) source.year = year;
  if (venue !== undefined) source.venue = venue;
  if (doi !== undefined) source.doi = doi;
  if (url !== undefined) source.url = url;
  return source;
}

/**
 * @param {object} p
 * @param {string} p.summary
 * @param {string} p.from
 * @param {object} [p.values]
 * @param {string[]} [p.tags]
 * @param {object} p.actor
 * @param {string} p.created
 * @returns {object} a schema-valid `phdude.result`
 */
export function newResult({ summary, from, values = {}, tags = [], actor, created }) {
  const text = requireText('summary', summary);
  return {
    schema: 'phdude.result',
    version: 1,
    id: makeId('result', text),
    created,
    actor,
    tags,
    summary: text,
    from,
    values,
    state: 'candidate',
  };
}

/**
 * @param {object} p
 * @param {number} p.n
 * @param {string} p.text
 * @param {string[]} [p.objectives]
 * @param {string[]} [p.tags]
 * @param {object} p.actor
 * @param {string} p.created
 * @returns {object} a schema-valid `phdude.question`
 */
export function newQuestion({ n, text, objectives = [], tags = [], actor, created }) {
  const body = requireText('text', text);
  return {
    schema: 'phdude.question',
    version: 1,
    id: makeSeqId('question', n),
    created,
    actor,
    tags,
    text: body,
    objectives,
    state: 'candidate',
  };
}

/**
 * @param {object} p
 * @param {number} p.n
 * @param {string} p.text
 * @param {string[]} [p.questions]
 * @param {string[]} [p.tags]
 * @param {object} p.actor
 * @param {string} p.created
 * @returns {object} a schema-valid `phdude.hypothesis`
 */
export function newHypothesis({ n, text, questions = [], tags = [], actor, created }) {
  const body = requireText('text', text);
  return {
    schema: 'phdude.hypothesis',
    version: 1,
    id: makeSeqId('hypothesis', n),
    created,
    actor,
    tags,
    text: body,
    questions,
    state: 'candidate',
  };
}

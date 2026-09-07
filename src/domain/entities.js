import { identityKey } from './candidates.js';
import { makeId, makeSeqId } from './ids.js';
import { normalizeKey, stableStringify } from './normalize.js';
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

// Who produced the record, recorded on the record itself so a reader never has to guess later.
// Only the CLI's own actor counts as manual: anything running under an agent host is an
// extraction until a human says otherwise, which is the safe direction to be wrong in.
function provenanceOf(provenance, actor, derived_from) {
  if (provenance !== undefined) return provenance;
  return {
    method: actor?.agent === 'cli' ? 'manual' : 'agent-extraction',
    derived_from,
  };
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
 * @param {object} [p.provenance]
 * @param {string[]} [p.derived_from] - ids the provenance defaults to when none is given
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
  provenance,
  derived_from = [],
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
    provenance: provenanceOf(provenance, actor, derived_from),
  };
}

/**
 * @param {object} p
 * @param {string} p.source
 * @param {string} [p.locator]
 * @param {string} p.excerpt
 * @param {string} [p.strength]
 * @param {string[]} [p.tags]
 * @param {object} [p.provenance]
 * @param {string[]} [p.derived_from] - ids the provenance defaults to when none is given
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
  provenance,
  derived_from = [],
  actor,
  created,
}) {
  const text = requireText('excerpt', excerpt);
  return {
    schema: 'phdude.evidence',
    version: 1,
    id: makeId('evidence', `${source} ${locator ?? ''} ${text}`),
    created,
    actor,
    tags,
    source,
    locator,
    excerpt: text,
    strength,
    state: 'candidate',
    provenance: provenanceOf(provenance, actor, derived_from),
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
    id: makeId('fact', `${normalizedKey} ${value} ${from_.artifact}`),
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
 * @param {string} [p.bibkey]
 * @param {string} [p.abstract]
 * @param {string[]} [p.keywords]
 * @param {{doi?: string, isbn?: string, arxiv?: string, pmid?: string, url?: string}} [p.identifiers]
 * @param {object} [p.provenance]
 * @param {object} [p.ext]
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
  bibkey,
  abstract,
  keywords,
  identifiers,
  provenance,
  ext,
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
  if (bibkey !== undefined) source.bibkey = bibkey;
  if (abstract !== undefined) source.abstract = abstract;
  if (keywords !== undefined) source.keywords = keywords;
  if (identifiers !== undefined) source.identifiers = identifiers;
  if (provenance !== undefined) source.provenance = provenance;
  if (ext !== undefined) source.ext = ext;
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

/**
 * @param {object} p
 * @param {string} p.name
 * @param {string} [p.design]
 * @param {string} [p.paradigm]
 * @param {string} [p.sampling]
 * @param {string[]} [p.instruments]
 * @param {string[]} [p.analysis]
 * @param {string[]} [p.limitations]
 * @param {string[]} [p.questions]
 * @param {string[]} [p.tags]
 * @param {object} p.actor
 * @param {string} p.created
 * @returns {object} a schema-valid `phdude.method`
 */
export function newMethod({
  name,
  design = '',
  paradigm = 'other',
  sampling,
  instruments = [],
  analysis = [],
  limitations = [],
  questions = [],
  tags = [],
  actor,
  created,
}) {
  const text = requireText('name', name);
  // The name alone is the identity: a study has one "cross-sectional survey", and describing
  // its design differently later must correct that record rather than mint a second one.
  const method = {
    schema: 'phdude.method',
    version: 1,
    id: makeId('method', text),
    created,
    actor,
    tags,
    name: text,
    design,
    paradigm,
    instruments,
    analysis,
    limitations,
    questions,
    state: 'candidate',
  };
  if (sampling !== undefined) method.sampling = sampling;
  return method;
}

/**
 * @param {object} p
 * @param {string} p.title
 * @param {string} p.rationale
 * @param {object} p.proposed_by
 * @param {string[]} [p.affects]
 * @param {object} [p.change]
 * @param {string} p.created
 * @param {string[]} [p.tags]
 * @returns {object} a schema-valid `phdude.decision`
 */
export function newDecision({
  title,
  rationale,
  proposed_by,
  affects = [],
  change = {},
  created,
  tags = [],
}) {
  const titleText = requireText('title', title);
  const rationaleText = requireText('rationale', rationale);
  // Sorted affects and sorted change keys keep the id independent of argument order, so the
  // same proposal always lands on the same record while a different one never collides.
  const material = [
    titleText,
    rationaleText,
    [...affects].sort().join(','),
    stableStringify(change),
  ].join('\n');
  return {
    schema: 'phdude.decision',
    version: 1,
    id: makeId('decision', material),
    created,
    actor: proposed_by,
    tags,
    title: titleText,
    rationale: rationaleText,
    proposed_by,
    approved_by: [],
    status: 'proposed',
    change,
    affects,
  };
}

/**
 * A literature hit a provider returned, recorded so the researcher can review it before it
 * ever becomes a Source. Identity is the work itself - its DOI, or its normalized title and
 * year (see domain/candidates.js `identityKey`) - never the provider that happened to return
 * it. Searching the same work again through a different provider list therefore lands on the
 * same record instead of a second one.
 * @param {object} p
 * @param {string} p.provider
 * @param {string[]} [p.providers] - every provider that returned this work
 * @param {string} p.external_id
 * @param {string} p.title
 * @param {string[]} [p.authors]
 * @param {number|null} [p.year]
 * @param {string|null} [p.venue]
 * @param {string|null} [p.doi]
 * @param {string|null} [p.url]
 * @param {string|null} [p.abstract]
 * @param {string} [p.type]
 * @param {boolean|null} [p.open_access]
 * @param {number|null} [p.cited_by]
 * @param {string} p.query
 * @param {string|null} [p.question] - the RQ id the search was run for
 * @param {string} p.search - the SEARCH id that produced it
 * @param {number} [p.score]
 * @param {object} [p.score_parts]
 * @param {boolean} [p.needs_approval]
 * @param {object} [p.ext]
 * @param {object} p.actor
 * @param {string} p.created
 * @returns {object} a schema-valid `phdude.candidate`
 */
export function newCandidate({
  provider,
  providers,
  external_id,
  title,
  authors = [],
  year = null,
  venue = null,
  doi = null,
  url = null,
  abstract = null,
  type = 'other',
  open_access = null,
  cited_by = null,
  query,
  question = null,
  search,
  score = 0,
  score_parts = {},
  needs_approval = false,
  ext,
  actor,
  created,
}) {
  const name = requireText('provider', provider);
  const externalId = requireText('external_id', external_id);
  const titleText = requireText('title', title);
  const candidate = {
    schema: 'phdude.candidate',
    version: 1,
    id: makeId('candidate', identityKey({ doi, title: titleText, year })),
    created,
    actor,
    tags: [],
    provider: name,
    providers: providers?.length ? providers : [name],
    external_id: externalId,
    title: titleText,
    authors,
    year,
    venue,
    doi,
    url,
    abstract,
    type,
    open_access,
    cited_by,
    query,
    question,
    search,
    score,
    score_parts,
    needs_approval,
    state: 'candidate',
  };
  if (ext !== undefined) candidate.ext = ext;
  return candidate;
}

/**
 * A recorded search: what was asked, of whom, under which filters, and every time it ran. The
 * query and the question are its identity, so re-running the same search for the same question
 * appends a run to one record instead of minting a second one.
 * @param {object} p
 * @param {string} p.query
 * @param {string|null} [p.question]
 * @param {string[]} [p.providers]
 * @param {object} [p.filters]
 * @param {{at: string, provider: string, count: number, new: number}[]} [p.runs]
 * @param {string} p.last_run
 * @param {object} p.actor
 * @param {string} p.created
 * @returns {object} a schema-valid `phdude.search`
 */
export function newSearch({
  query,
  question = null,
  providers = [],
  filters = {},
  runs = [],
  last_run,
  actor,
  created,
}) {
  const text = requireText('query', query);
  return {
    schema: 'phdude.search',
    version: 1,
    id: makeId('search', `${text}|${question ?? ''}`),
    created,
    actor,
    tags: [],
    query: text,
    question,
    providers,
    filters,
    runs,
    last_run,
  };
}

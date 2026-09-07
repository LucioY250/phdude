import { join } from 'node:path';
import { assignBibkeys } from '../domain/bibkey.js';
import { toBibtex, toCslJson } from '../domain/bibtex.js';
import { parseId } from '../domain/ids.js';
import { normalizeText } from '../domain/normalize.js';
import { PhdudeError } from '../domain/errors.js';
import { loadSnapshot } from './snapshot.js';
import { assertUpToDate } from './guard.js';

const DOI_RE = /^10\.\d{4,9}\/\S+$/;

function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function doiOf(source) {
  return source.identifiers?.doi ?? source.doi;
}

// "Cited" means what spec S3.3 says it means: evidence's `source` is literally the SRC id.
// Evidence that cites a raw artifact instead (no formal source recorded yet) does not count -
// that is exactly the gap `uncited-source` exists to surface.
function citedSourceId(evidenceItem) {
  return parseId(evidenceItem.source)?.type === 'source' ? evidenceItem.source : null;
}

async function loadRegistry(store) {
  const snapshot = await loadSnapshot(store);
  const sources = [...snapshot.sources].sort(byId);
  const evidence = [...snapshot.evidence].sort(byId);
  const keys = assignBibkeys(sources);

  const citedBy = new Map();
  for (const item of evidence) {
    const sourceId = citedSourceId(item);
    if (sourceId) citedBy.set(sourceId, (citedBy.get(sourceId) ?? 0) + 1);
  }

  return { sources, evidence, keys, citedBy };
}

/**
 * @param {{store: object}} deps
 * @returns {Promise<{id: string, bibkey: string, authors: string[], year: number|null,
 *   title: string, type: string, doi: string|null, cited_by: number}[]>} sorted by bibkey
 */
export async function list({ store }) {
  const { sources, keys, citedBy } = await loadRegistry(store);
  const rows = sources.map((source) => ({
    id: source.id,
    bibkey: keys.get(source.id),
    authors: source.authors ?? [],
    year: source.year ?? null,
    title: source.title,
    type: source.type,
    doi: doiOf(source) ?? null,
    cited_by: citedBy.get(source.id) ?? 0,
  }));
  rows.sort((a, b) => (a.bibkey < b.bibkey ? -1 : a.bibkey > b.bibkey ? 1 : 0));
  return rows;
}

/**
 * Pure verification of the citation registry (PRD S37 / spec S3.3): every source cited by at
 * least one evidence item, every evidence item's source exists, DOI format, missing
 * title/authors/year, duplicate sources (normalized title+year), and duplicate explicit
 * bibkeys. `uncited-source` is informational only - it never fails `ok`.
 * @param {{store: object}} deps
 * @returns {Promise<{ok: boolean, findings: {kind: string, id: string, message: string,
 *   hint: string}[]}>}
 */
export async function check({ store }) {
  const { sources, evidence, citedBy } = await loadRegistry(store);
  const findings = [];

  for (const source of sources) {
    if ((citedBy.get(source.id) ?? 0) === 0) {
      findings.push({
        kind: 'uncited-source',
        id: source.id,
        message: `${source.id} is not cited by any evidence`,
        hint: `phdude add evidence --json '{"source":"${source.id}",...}'`,
      });
    }
  }

  for (const item of evidence) {
    const referenced = await store.readEntity(item.source);
    if (!referenced) {
      findings.push({
        kind: 'evidence-missing-source',
        id: item.id,
        message: `${item.id} cites ${item.source}, which does not exist`,
        hint: 'phdude knowledge list to find the right id, then add a corrected evidence item citing it',
      });
    }
  }

  for (const source of sources) {
    const doi = doiOf(source);
    if (doi !== undefined && !DOI_RE.test(doi)) {
      findings.push({
        kind: 'invalid-doi',
        id: source.id,
        message: `${source.id} has an invalid DOI: ${doi}`,
        hint: 'DOIs match ^10.\\d{4,9}/\\S+$',
      });
    }

    const missing = [];
    if (!source.title) missing.push('title');
    if (!source.authors || source.authors.length === 0) missing.push('authors');
    if (source.year === undefined) missing.push('year');
    if (missing.length > 0) {
      findings.push({
        kind: 'missing-field',
        id: source.id,
        message: `${source.id} is missing ${missing.join(', ')}`,
        hint: `phdude add source --json '{"title":"...","authors":["..."],"year":...}' with the missing field(s) set`,
      });
    }
  }

  const byTitleYear = new Map();
  for (const source of sources) {
    const dupKey = `${normalizeText(source.title ?? '')} ${source.year ?? ''}`;
    if (!byTitleYear.has(dupKey)) byTitleYear.set(dupKey, []);
    byTitleYear.get(dupKey).push(source.id);
  }
  for (const ids of byTitleYear.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      findings.push({
        kind: 'duplicate-source',
        id,
        message: `${id} shares its title and year with ${ids.filter((x) => x !== id).join(', ')}`,
        hint: 'merge the duplicate sources, or correct the title/year that differs',
      });
    }
  }

  const byExplicitKey = new Map();
  for (const source of sources) {
    if (!source.bibkey) continue;
    if (!byExplicitKey.has(source.bibkey)) byExplicitKey.set(source.bibkey, []);
    byExplicitKey.get(source.bibkey).push(source.id);
  }
  for (const [bibkey, ids] of byExplicitKey) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      findings.push({
        kind: 'duplicate-bibkey',
        id,
        message: `${id} declares bibkey "${bibkey}", also used by ${ids.filter((x) => x !== id).join(', ')}`,
        hint: 'give each source a distinct bibkey',
      });
    }
  }

  findings.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const ok = findings.every((f) => f.kind === 'uncited-source');
  return { ok, findings };
}

const EXPORT_FORMATS = ['bibtex', 'csl-json'];

/**
 * Writes the citation registry to the workspace root. The registry is derived, never
 * canonical (spec S3.3): the export writes no event. A write, so it still refuses on an
 * out-of-date workspace even though it produces no knowledge object.
 * @param {{store: object, format?: 'bibtex'|'csl-json'}} deps
 * @returns {Promise<{path: string, count: number}>}
 */
export async function exportRegistry({ store, format = 'bibtex' }) {
  assertUpToDate(await store.readProject());
  if (!EXPORT_FORMATS.includes(format)) {
    throw new PhdudeError(
      'USAGE',
      `unknown export format: ${format}`,
      `valid formats: ${EXPORT_FORMATS.join(', ')}`,
    );
  }

  const { sources, keys } = await loadRegistry(store);
  const relPath = format === 'csl-json' ? 'references.json' : 'references.bib';
  const text =
    format === 'csl-json'
      ? JSON.stringify(toCslJson(sources, keys), null, 2) + '\n'
      : toBibtex(sources, keys);

  await store.writeTextAtomic(relPath, text);
  return { path: join(store.root, relPath), count: sources.length };
}

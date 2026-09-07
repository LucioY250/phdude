import { isAbsolute, normalize, sep } from 'node:path';
import { newResult } from './entities.js';
import { PhdudeError } from './errors.js';
import { stableStringify } from './normalize.js';

const ANALYSIS_DIR = 'analysis/';

// Enough of a failing script's stderr to see what went wrong, and a ceiling so one runaway run
// cannot turn the analysis record into a log file.
const STDERR_TAIL_CHARS = 2000;

function relative(input) {
  const text = String(input ?? '').trim();
  if (text === '' || isAbsolute(text)) return null;
  const rel = normalize(text).split(sep).join('/');
  return rel.split('/').includes('..') ? null : rel;
}

/**
 * A script and its results file are paths PhDude will spawn and read from a record a researcher
 * can edit, so both have to stay inside `analysis/`: a `../` in either would let a declared
 * analysis run or read something the workspace never held.
 * @param {string} input
 * @param {string} [field] - which field is being checked, for the error
 * @param {string} [example] - what a good value looks like, for the hint
 * @returns {string} the path with `/` separators, relative to the workspace root
 */
export function analysisPath(input, field = 'script', example = 'analysis/describe.mjs') {
  const rel = relative(input);
  if (rel === null || !rel.startsWith(ANALYSIS_DIR) || rel.length === ANALYSIS_DIR.length) {
    throw new PhdudeError(
      'VALIDATION',
      `analysis ${field} outside analysis/: ${input}`,
      `an analysis ${field} looks like ${example}`,
    );
  }
  return rel;
}

/**
 * A file the analysis declares as an output. It may live anywhere the workspace does - a figure
 * under `figures/out/`, a table under `tables/out/` - but never outside it, because PhDude hashes
 * whatever this names after every run.
 * @param {string} input
 * @param {string} [field]
 * @returns {string}
 */
export function outputPath(input, field = 'output file') {
  const rel = relative(input);
  if (rel === null) {
    throw new PhdudeError(
      'VALIDATION',
      `analysis ${field} outside the workspace: ${input}`,
      'an output path is workspace-relative, e.g. analysis/out/describe/table.csv',
    );
  }
  return rel;
}

function slug(name) {
  const text = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text === '' ? 'analysis' : text;
}

/**
 * @param {string} name
 * @returns {string} where results.json goes when the analysis does not say
 */
export function defaultResultsPath(name) {
  return `${ANALYSIS_DIR}out/${slug(name)}/results.json`;
}

function lastSuccessfulRun(runs) {
  const list = Array.isArray(runs) ? runs : [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.exit === 0) return list[i];
  }
  return null;
}

/**
 * What this run would read, and whether reading it again could tell the researcher anything new.
 * "Up to date" is deliberately narrow: the same inputs, at the same bytes, as the last run that
 * actually succeeded. A failed run leaves the analysis stale, and an input PhDude cannot hash
 * leaves it stale too - the safe direction, because the cost of being wrong is one re-run.
 * @param {object} analysis
 * @param {object[]} datasets - the DATASET records the analysis names as inputs
 * @returns {{inputHashes: Record<string, string|null>, upToDate: boolean}}
 */
export function planRun(analysis, datasets) {
  const byId = new Map((datasets ?? []).map((d) => [d.id, d]));
  const inputHashes = {};
  for (const id of analysis?.inputs ?? []) {
    const hash = byId.get(id)?.hash;
    inputHashes[id] = typeof hash === 'string' && hash !== '' ? hash : null;
  }

  const last = lastSuccessfulRun(analysis?.runs);
  const complete = Object.values(inputHashes).every((hash) => hash !== null);
  const upToDate =
    last !== null &&
    complete &&
    stableStringify(last.input_hashes ?? {}) === stableStringify(inputHashes);

  return { inputHashes, upToDate };
}

function entryProblem(entry, index, seen) {
  const where = `results[${index}]`;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return `${where} is not an object`;
  }
  const key = String(entry.key ?? '').trim();
  if (key === '') return `${where} has no key`;
  if (seen.has(key)) return `${where} repeats the key "${key}"`;
  if (String(entry.summary ?? '').trim() === '') return `${where} (${key}) has no summary`;
  const values = entry.values;
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    return `${where} (${key}) has no values object`;
  }
  return null;
}

/**
 * The RESULT objects a run's `results.json` asks for. Every entry PhDude cannot turn into a
 * result is reported rather than thrown, so one malformed entry names itself instead of hiding
 * behind the first exception.
 * @param {object} json - the parsed results.json
 * @param {string} analysisId
 * @param {object} actor
 * @param {string} created
 * @returns {{results: object[], invalid: string[]}}
 */
export function resultsFromJson(json, analysisId, actor, created) {
  const entries = Array.isArray(json?.results) ? json.results : [];
  const results = [];
  const invalid = [];
  const seen = new Set();

  for (const [index, entry] of entries.entries()) {
    const problem = entryProblem(entry, index, seen);
    if (problem !== null) {
      invalid.push(problem);
      continue;
    }

    const key = String(entry.key).trim();
    seen.add(key);
    const result = newResult({
      summary: String(entry.summary).trim(),
      from: analysisId,
      values: entry.values,
      actor,
      created,
    });
    // `unit` has no home of its own on a result, so it rides with the rest of what the analysis
    // contributed. `ext.analysis` is what `diffResults` matches on and what `repro` reads.
    result.ext = { analysis: { key, run_at: created } };
    const unit = typeof entry.unit === 'string' ? entry.unit.trim() : '';
    if (unit !== '') result.ext.analysis.unit = unit;
    results.push(result);
  }

  return { results, invalid };
}

function sameFinding(existing, incoming) {
  return (
    stableStringify(existing.values ?? {}) === stableStringify(incoming.values ?? {}) &&
    (existing.ext?.analysis?.unit ?? null) === (incoming.ext?.analysis?.unit ?? null)
  );
}

/**
 * What one run's results change about what the analysis already recorded, matched by
 * `ext.analysis.key`. A key whose finding came back identical is kept untouched; one whose
 * summary changed mints a new result and marks the old one `rejected` with `superseded_by`, so
 * the record of what was believed survives the re-run.
 *
 * A result id is derived from its summary and its analysis (ADR 3), so a key that comes back
 * with new values under the *same* summary is the same record: it is rewritten in place and
 * cannot supersede itself. A script that wants version history puts the finding in the summary.
 *
 * Existing results for keys this run did not report are left alone entirely.
 * @param {object[]} existing - the RESULTs already recorded for this analysis
 * @param {object[]} incoming - what `resultsFromJson` built
 * @returns {{create: object[], reject: object[], keep: object[]}}
 */
export function diffResults(existing, incoming) {
  const byKey = new Map();
  for (const obj of existing ?? []) {
    const key = obj?.ext?.analysis?.key;
    if (typeof key === 'string' && key !== '') byKey.set(key, obj);
  }

  const create = [];
  const reject = [];
  const keep = [];

  for (const result of incoming ?? []) {
    const current = byKey.get(result.ext.analysis.key);
    if (current === undefined) {
      create.push(result);
      continue;
    }
    if (current.id === result.id) {
      if (sameFinding(current, result)) keep.push(current);
      else create.push(result);
      continue;
    }
    create.push(result);
    reject.push({ ...current, state: 'rejected', superseded_by: result.id });
  }

  return { create, reject, keep };
}

/**
 * @param {string} text
 * @returns {string} the end of a failing script's stderr, capped
 */
export function stderrTail(text) {
  const s = String(text ?? '');
  return s.length <= STDERR_TAIL_CHARS ? s : s.slice(-STDERR_TAIL_CHARS);
}

// The staleness graph (spec §3.6). An analysis, a table and a figure are all the same shape of
// thing: something produced from recorded inputs, with a run that wrote down what those inputs
// hashed to. Comparing those hashes with the workspace as it is now is the whole report - and
// it is pure, so the application only has to hash the dataset files and say which output paths
// are on disk.
import { staleness as figureStaleness } from './figures.js';
import { sha256 } from './hash.js';
import { stableStringify } from './normalize.js';

const ORDER = ['up-to-date', 'stale', 'never-run', 'missing-output'];

/**
 * What every DATASET and RESULT the workspace holds hashes to right now. A dataset is its file's
 * bytes; a result is its values, because a summary edit does not change what a table would
 * render. Editing the file moves the analysis directly, and the table and figure drawn from its
 * results through `upstreamByResult` below.
 * @param {{datasets?: object[], results?: object[], fileHashes?: Record<string, string|null>}} snapshot
 * @returns {Record<string, string|null>}
 */
function currentHashes({ datasets = [], results = [], fileHashes = {} }) {
  const hashes = {};
  for (const dataset of datasets) hashes[dataset.id] = fileHashes[dataset.path] ?? null;
  for (const result of results) hashes[result.id] = sha256(stableStringify(result.values ?? {}));
  return hashes;
}

function registeredHashes(datasets = []) {
  return Object.fromEntries(datasets.map((d) => [d.id, d.hash ?? null]));
}

function lastSuccessfulRun(runs) {
  const list = Array.isArray(runs) ? runs : [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.exit === 0) return list[i];
  }
  return null;
}

// A file whose bytes are no longer the ones its DATASET record was registered against. The two
// readings are different problems with different fixes, so this one is checked first: re-running
// against a file the workspace has not registered would only record the drift a second time.
function unregistered(input, current, registered) {
  if (current === null || registered[input] === undefined || registered[input] === null)
    return null;
  if (current === registered[input]) return null;
  return { kind: 'unregistered-input', input, registered: registered[input], current };
}

function inputReasons(inputs, recorded, current, registered) {
  const reasons = [];
  for (const input of inputs) {
    const now = current[input] ?? null;
    const then = recorded[input] ?? null;
    if (now === null) {
      reasons.push({ kind: 'missing-input', input });
      continue;
    }
    const drift = unregistered(input, now, registered);
    if (drift !== null) reasons.push(drift);
    else if (now !== then) {
      reasons.push({ kind: 'stale-input', input, recorded: then, current: now });
    }
  }
  return reasons;
}

function statusFrom(reasons) {
  if (reasons.some((r) => r.kind === 'missing-output')) return 'missing-output';
  const moved = ['stale-input', 'missing-input', 'unregistered-input', 'upstream-stale'];
  return reasons.some((r) => moved.includes(r.kind)) ? 'stale' : 'up-to-date';
}

// A RESULT is only as current as the analysis that produced it. Staleness has to travel that hop
// or the report says a figure in the draft is fine at exactly the moment its numbers stopped
// being the ones on disk - the spec's success condition is the analysis, the table *and* the
// figure. `never-run` travels for the same reason: nothing has produced those numbers yet.
const UPSTREAM_STALE = ['stale', 'never-run'];

function upstreamByResult(analyses, results = []) {
  const stale = new Map(
    analyses
      .filter((item) => UPSTREAM_STALE.includes(item.status))
      .map((item) => [item.id, item.status]),
  );
  const byResult = new Map();
  for (const result of results) {
    const status = stale.get(result.from);
    if (status !== undefined) byResult.set(result.id, { analysis: result.from, status });
  }
  return byResult;
}

function upstreamReasons(inputs, upstream) {
  const reasons = [];
  for (const input of inputs) {
    const hop = upstream?.get(input);
    if (hop === undefined) continue;
    reasons.push({ kind: 'upstream-stale', input, analysis: hop.analysis, status: hop.status });
  }
  return reasons;
}

function neverRun(kind, obj, reasons = []) {
  return {
    kind,
    id: obj.id,
    name: obj.name,
    status: 'never-run',
    reasons: [...reasons, { kind: 'never-run' }],
  };
}

function analysisItem(analysis, { present, current, registered }) {
  const run = lastSuccessfulRun(analysis.runs);
  if (run === null) return neverRun('analysis', analysis);

  const declared = [analysis.outputs?.results, ...(analysis.outputs?.files ?? [])].filter(Boolean);
  const reasons = [
    ...declared
      .filter((path) => present[path] !== true)
      .map((path) => ({
        kind: 'missing-output',
        path,
      })),
    ...inputReasons(analysis.inputs ?? [], run.input_hashes ?? {}, current, registered),
  ];
  return {
    kind: 'analysis',
    id: analysis.id,
    name: analysis.name,
    status: statusFrom(reasons),
    reasons,
  };
}

// A table's build reads exactly one source, so its run records one `source_hash` rather than a
// map. Every build succeeds or throws, which is why there is no exit code to skip past here.
function tableItem(table, { present, current, registered, upstream }) {
  const run = Array.isArray(table.runs) ? (table.runs.at(-1) ?? null) : null;
  if (run === null) return neverRun('table', table);

  const source = table.source?.result ?? table.source?.dataset ?? null;
  const sources = source === null ? [] : [source];
  const recorded = source === null ? {} : { [source]: run.source_hash ?? null };
  const reasons = [
    ...Object.values(table.outputs ?? {})
      .filter((path) => present[path] !== true)
      .map((path) => ({ kind: 'missing-output', path })),
    ...inputReasons(sources, recorded, current, registered),
    ...upstreamReasons(sources, upstream),
  ];
  return { kind: 'table', id: table.id, name: table.name, status: statusFrom(reasons), reasons };
}

// The figure rules already say everything a figure can be wrong about (missing alt text
// included), so they are read rather than reimplemented; only the unregistered-input reading,
// which needs the DATASET records, is added on top.
function figureItem(figure, { present, current, registered, upstream }) {
  const report = figureStaleness(figure, { inputHashes: current, present });
  if (report.status === 'never-run') {
    return {
      kind: 'figure',
      id: report.id,
      name: report.name,
      status: report.status,
      reasons: report.findings,
    };
  }

  // The figure rules compare against the last run and stop there, so the drift reading is added
  // here - and it replaces a stale-input finding for the same input rather than doubling it.
  const drift = new Map();
  for (const input of figure.inputs ?? []) {
    const reason = unregistered(input, current[input] ?? null, registered);
    if (reason !== null) drift.set(input, reason);
  }
  const reasons = [
    ...report.findings.filter((f) => !(f.kind === 'stale-input' && drift.has(f.input))),
    ...drift.values(),
    ...upstreamReasons(figure.inputs ?? [], upstream),
  ];
  return {
    kind: 'figure',
    id: report.id,
    name: report.name,
    status: report.status === 'missing-output' ? report.status : statusFrom(reasons),
    reasons,
  };
}

/**
 * Pure: what every analysis, table and figure in the workspace is, against the workspace as it
 * is now. `up-to-date` is the only status that needs nothing done to it; the rest carry the
 * reasons that produced them, so a report can say which input moved rather than only that
 * something did.
 * @param {{analyses?: object[], tables?: object[], figures?: object[], datasets?: object[],
 *   results?: object[], fileHashes?: Record<string, string|null>,
 *   present?: Record<string, boolean>}} snapshot - `fileHashes` is the current hash of each
 *   dataset file by path (`null` when the file is gone); `present` says which declared output
 *   paths are on disk.
 * @returns {{kind: 'analysis'|'table'|'figure', id: string, name: string,
 *   status: 'up-to-date'|'stale'|'never-run'|'missing-output', reasons: object[]}[]}
 */
export function staleness(snapshot = {}) {
  const state = {
    present: snapshot.present ?? {},
    current: currentHashes(snapshot),
    registered: registeredHashes(snapshot.datasets),
  };

  const analyses = (snapshot.analyses ?? []).map((a) => analysisItem(a, state));
  const downstream = { ...state, upstream: upstreamByResult(analyses, snapshot.results) };

  return [
    ...analyses,
    ...(snapshot.tables ?? []).map((t) => tableItem(t, downstream)),
    ...(snapshot.figures ?? []).map((f) => figureItem(f, downstream)),
  ];
}

/**
 * How many items are in each status, in a fixed order, so a report never has to invent one.
 * @param {{status: string}[]} items
 * @returns {Record<string, number>}
 */
export function reproCounts(items) {
  const counts = Object.fromEntries(ORDER.map((status) => [status, 0]));
  for (const item of items) counts[item.status]++;
  return counts;
}

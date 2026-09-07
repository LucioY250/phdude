import { join } from 'node:path';
import {
  analysisPath,
  defaultResultsPath,
  diffResults,
  outputPath,
  planRun,
  resultsFromJson,
  stderrTail,
} from '../domain/analysis.js';
import { newAnalysis } from '../domain/entities.js';
import { PhdudeError } from '../domain/errors.js';
import { sha256 } from '../domain/hash.js';
import { parseId } from '../domain/ids.js';
import { stableStringify } from '../domain/normalize.js';
import { assertExecutionAllowed, executionTimeoutMs, runtimeCommand } from '../domain/policy.js';
import { validateResultsJson } from '../schemas/index.js';
import { assertUpToDate } from './guard.js';
import { assertPathsInsideRoot } from './paths.js';

const POLICY_PATH = join('.phdude', 'research-policy.yaml');

const ALLOWED_FIELDS = ['name', 'runtime', 'script', 'args', 'inputs', 'outputs', 'params'];

// The `runtime` values an analysis may declare (spec §3.3). Which executable each one resolves
// to is the policy's business, not the record's: `runtimeCommand` answers that at run time, so a
// workspace can point `node` somewhere else without every analysis being rewritten.
const RUNTIMES = ['node', 'python3', 'Rscript', 'other'];

// What the declaration says, as opposed to what the record has accumulated. Re-declaring an
// analysis compares exactly these; `created`, `actor`, `runs` and `state` belong to the record.
const DECLARED = ['runtime', 'script', 'args', 'inputs', 'outputs', 'params'];

const CONTRACT_HINT = '{ "results": [ { "key", "summary", "values", "unit"? } ] }';

const CONFINED_HINT =
  'an analysis runs and writes inside the workspace, not through a link that leaves it';

// Lexical confinement says `analysis/evil.mjs` is under `analysis/`; it cannot say what the name
// points at. The declaration is checked here and again at run time, because a link planted after
// the declaration would otherwise be the one PhDude spawns.
function declaredPaths(analysis) {
  return [analysis.outputs.results, ...analysis.outputs.files];
}

function assertKnownFields(spec) {
  const unknown = Object.keys(spec ?? {})
    .filter((key) => !ALLOWED_FIELDS.includes(key))
    .sort();
  if (unknown.length > 0) {
    throw new PhdudeError(
      'VALIDATION',
      `unknown field(s) for analysis: ${unknown.join(', ')}`,
      `allowed: ${ALLOWED_FIELDS.join(', ')}`,
    );
  }
}

function stringList(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new PhdudeError(
      'VALIDATION',
      `${field} must be an array of strings`,
      `e.g. ${field}: []`,
    );
  }
  return [...value];
}

function plainObject(value, field) {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PhdudeError('VALIDATION', `${field} must be an object`, `e.g. ${field}: {}`);
  }
  return value;
}

async function assertInputsExist(store, inputs) {
  for (const id of inputs) {
    if (parseId(id)?.type !== 'dataset') {
      throw new PhdudeError(
        'VALIDATION',
        `not a dataset id: ${id}`,
        'an analysis input is a DATASET id; run phdude data list',
      );
    }
    if (!(await store.readEntity(id))) {
      throw new PhdudeError(
        'VALIDATION',
        `unknown input dataset ${id}`,
        'register it first with phdude data add <path>',
      );
    }
  }
}

function declaredOutputs(outputs, name) {
  const given = plainObject(outputs, 'outputs');
  const unknown = Object.keys(given)
    .filter((key) => key !== 'results' && key !== 'files')
    .sort();
  if (unknown.length > 0) {
    throw new PhdudeError(
      'VALIDATION',
      `unknown field(s) for outputs: ${unknown.join(', ')}`,
      'allowed: results, files',
    );
  }
  const results = analysisPath(
    given.results ?? defaultResultsPath(name),
    'results output',
    defaultResultsPath(name),
  );
  return { results, files: stringList(given.files, 'outputs.files').map((f) => outputPath(f)) };
}

/**
 * Declares an analysis: a script, the datasets it reads, and where it leaves its results.
 * Nothing runs here. The name is the identity, so declaring the same name again corrects the
 * declaration in place - a mistyped script path is fixed with the same command that made it -
 * and the record keeps its creation time, its state and every run it has already recorded.
 * @param {{store: object, clock: () => string, actor: object,
 *   realpath: (path: string) => Promise<string>}} deps
 * @param {{name: string, runtime?: string, script: string, args?: string[], inputs?: string[],
 *   outputs?: {results?: string, files?: string[]}, params?: object}} spec
 * @returns {Promise<{analysis: object, created: boolean, changed: boolean}>}
 */
export async function add({ store, clock, actor, realpath }, spec) {
  assertUpToDate(await store.readProject());
  assertKnownFields(spec);

  const runtime = spec?.runtime ?? 'node';
  if (!RUNTIMES.includes(runtime)) {
    throw new PhdudeError(
      'VALIDATION',
      `unknown analysis runtime: ${runtime}`,
      `allowed: ${RUNTIMES.join(', ')}`,
    );
  }

  const inputs = stringList(spec?.inputs, 'inputs');
  await assertInputsExist(store, inputs);

  const declared = newAnalysis({
    name: spec?.name,
    runtime,
    script: analysisPath(spec?.script),
    args: stringList(spec?.args, 'args'),
    inputs,
    outputs: declaredOutputs(spec?.outputs, spec?.name),
    params: plainObject(spec?.params, 'params'),
    actor,
    created: clock(),
  });

  await assertPathsInsideRoot(
    { realpath },
    store.root,
    [declared.script, ...declaredPaths(declared)],
    CONFINED_HINT,
  );

  const recorded = await store.readEntity(declared.id);
  if (recorded) {
    const changed = DECLARED.some(
      (field) => stableStringify(recorded[field]) !== stableStringify(declared[field]),
    );
    if (!changed) return { analysis: recorded, created: false, changed: false };

    const corrected = { ...recorded };
    for (const field of DECLARED) corrected[field] = declared[field];
    await store.writeEntity(corrected);
    await store.appendEvent({
      ts: clock(),
      op: 'analyze',
      actor,
      ids: [corrected.id],
      summary: `analysis redeclared: ${corrected.name}`,
    });
    return { analysis: corrected, created: false, changed: true };
  }

  await store.writeEntity(declared);
  await store.appendEvent({
    ts: clock(),
    op: 'analyze',
    actor,
    ids: [declared.id],
    summary: `analysis declared: ${declared.name}`,
  });
  return { analysis: declared, created: true, changed: true };
}

/**
 * @param {{store: object}} deps
 * @returns {Promise<object[]>} every declared analysis, by id
 */
export async function list({ store }) {
  return store.listEntities('analysis');
}

/**
 * @param {{store: object}} deps
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function show({ store }, id) {
  if (parseId(id)?.type !== 'analysis') {
    throw new PhdudeError(
      'USAGE',
      `not an analysis id: ${id}`,
      'phdude analyze show <ANALYSIS-id>',
    );
  }
  const obj = await store.readEntity(id);
  if (!obj) throw new PhdudeError('USAGE', `not found: ${id}`, 'run phdude analyze list');
  return obj;
}

/**
 * @param {{store: object}} deps
 * @param {string} id
 * @returns {Promise<{id: string, name: string, runs: object[]}>}
 */
export async function runs(deps, id) {
  const analysis = await show(deps, id);
  return { id: analysis.id, name: analysis.name, runs: analysis.runs };
}

async function readOutputBytes(readBytes, rel) {
  try {
    return await readBytes(rel);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return null;
    throw err;
  }
}

async function appendRun(store, analysis, run) {
  const updated = { ...analysis, runs: [...analysis.runs, run] };
  await store.writeEntity(updated);
  return updated;
}

function parseResultsFile(text, rel) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new PhdudeError('VALIDATION', `malformed results.json: ${rel}`, CONTRACT_HINT, [
      err.message,
    ]);
  }
}

async function readResults({ store, actor }, analysis, at) {
  const rel = analysis.outputs.results;
  const text = await store.readText(rel);
  if (text === null) {
    throw new PhdudeError(
      'VALIDATION',
      `the analysis wrote no results file: ${rel}`,
      'the script writes results.json where the analysis declares it, or declare another path',
    );
  }

  const json = parseResultsFile(text, rel);
  const shape = validateResultsJson(json);
  if (!shape.ok) {
    throw new PhdudeError(
      'VALIDATION',
      `${rel} does not match the results contract`,
      CONTRACT_HINT,
      shape.errors,
    );
  }

  const { results, invalid } = resultsFromJson(json, analysis.id, actor, at);
  if (invalid.length > 0) {
    throw new PhdudeError(
      'VALIDATION',
      `${rel} holds ${invalid.length} unusable result(s)`,
      'every result needs a non-empty key, a non-empty summary and a values object',
      invalid,
    );
  }
  return results;
}

async function recordFailure(deps, analysis, run, summary) {
  const recorded = await appendRun(deps.store, analysis, run);
  await deps.store.appendEvent({
    ts: deps.clock(),
    op: 'analyze',
    actor: deps.actor,
    ids: [analysis.id],
    summary,
  });
  return recorded;
}

/**
 * Runs a declared analysis and records what it produced. The order is the whole safety story:
 * the workspace has to be current, the policy has to allow execution at all, and the inputs have
 * to have changed since the last successful run - only then does anything spawn.
 *
 * A run that fails is still recorded: the exit code and the tail of its stderr go on the record
 * so `phdude analyze runs` can say what happened, and no RESULT is written. A run whose
 * `results.json` PhDude cannot read is not recorded at all, because a run with no readable
 * output would otherwise count as the successful run that makes the analysis "up to date".
 * @param {{store: object, clock: () => string, actor: object,
 *   runner: import('../ports/analysis-runner.js').AnalysisRunner,
 *   readBytes: (rel: string) => Promise<Buffer>,
 *   realpath: (path: string) => Promise<string>}} deps
 * @param {{id: string, allowExec?: boolean, force?: boolean}} options
 * @returns {Promise<{analysis: object, ran: boolean, reason?: string, run?: object,
 *   created: object[], rejected: object[], kept: object[]}>}
 */
export async function run(deps, { id, allowExec = false, force = false }) {
  const { store, clock, actor, runner, readBytes, realpath } = deps;
  assertUpToDate(await store.readProject());

  // The id is resolved before the policy, so a typo'd id is a usage error on both `analyze run`
  // and `figure build` rather than "execution is disabled" on one of them.
  const analysis = await show({ store }, id);

  const policy = await store.readYaml(POLICY_PATH);
  assertExecutionAllowed(policy, { allowExec });

  const datasets = [];
  for (const input of analysis.inputs) {
    const dataset = await store.readEntity(input);
    if (!dataset) {
      throw new PhdudeError(
        'VALIDATION',
        `unknown input dataset ${input} on ${analysis.id}`,
        'register it again with phdude data add <path>',
      );
    }
    datasets.push(dataset);
  }

  const { inputHashes, upToDate } = planRun(analysis, datasets);
  if (upToDate && !force) {
    return { analysis, ran: false, reason: 'up to date', created: [], rejected: [], kept: [] };
  }

  await assertPathsInsideRoot(
    { realpath },
    store.root,
    [analysis.script, ...declaredPaths(analysis)],
    CONFINED_HINT,
  );

  const command = runtimeCommand(policy, analysis.runtime);
  const timeoutMs = executionTimeoutMs(policy);
  const at = clock();
  const outcome = await runner.run({
    runtime: command,
    script: analysis.script,
    args: analysis.args,
    cwd: store.root,
    env: { PHDUDE_WORKSPACE: store.root, PHDUDE_ANALYSIS: analysis.id },
    timeoutMs,
  });

  if (outcome.timedOut || outcome.exitCode !== 0) {
    const tail = stderrTail(outcome.stderr);
    const signal =
      typeof outcome.signal === 'string' && outcome.signal !== '' ? outcome.signal : null;
    const failed = {
      at,
      exit: outcome.timedOut ? null : outcome.exitCode,
      duration_ms: outcome.durationMs,
      input_hashes: inputHashes,
      output_hashes: {},
      results: [],
    };
    if (outcome.timedOut) failed.timed_out = true;
    if (signal !== null) failed.signal = signal;
    if (tail !== '') failed.stderr_tail = tail;

    const details = tail === '' ? null : tail.trimEnd().split('\n').slice(-10);

    if (outcome.timedOut) {
      const seconds = Math.round(timeoutMs / 1000);
      await recordFailure(deps, analysis, failed, `analysis timed out: ${analysis.name}`);
      throw new PhdudeError(
        'TOOL_MISSING',
        `analysis timed out after ${seconds}s: ${analysis.name}`,
        'raise execution.timeout_seconds in .phdude/research-policy.yaml, or make the script do less',
      );
    }

    // No exit code and no timeout means a signal ended the run. That shape is identical to a
    // clean exit apart from the missing code, so it is named here rather than left to read as
    // one: the script never got to write its results, whatever it had already printed.
    if (outcome.exitCode === null) {
      const named = signal === null ? '' : ` by ${signal}`;
      await recordFailure(deps, analysis, failed, `analysis killed${named}: ${analysis.name}`);
      throw new PhdudeError(
        'EXECUTION',
        `the analysis script was killed${named}: ${analysis.name}`,
        `something outside PhDude ended the run; the recorded output is in phdude analyze runs ${analysis.id}`,
        details,
      );
    }

    await recordFailure(
      deps,
      analysis,
      failed,
      `analysis failed (exit ${outcome.exitCode}): ${analysis.name}`,
    );
    throw new PhdudeError(
      'EXECUTION',
      `the analysis script exited ${outcome.exitCode}: ${analysis.name}`,
      `read the recorded output with phdude analyze runs ${analysis.id}`,
      details,
    );
  }

  // The script has run by now, so a path that was absent before it started may be a link it
  // planted; what PhDude reads and hashes is checked against the real workspace, not the record.
  await assertPathsInsideRoot({ realpath }, store.root, declaredPaths(analysis), CONFINED_HINT);

  const results = await readResults({ store, actor }, analysis, at);
  const existing = (await store.listEntities('result')).filter((r) => r.from === analysis.id);
  const { create, reject, keep } = diffResults(existing, results);

  for (const obj of create) await store.writeEntity(obj);
  for (const obj of reject) await store.writeEntity(obj);

  const output_hashes = {};
  for (const rel of [analysis.outputs.results, ...analysis.outputs.files]) {
    const bytes = await readOutputBytes(readBytes, rel);
    if (bytes !== null) output_hashes[rel] = sha256(bytes);
  }

  const recorded = await appendRun(store, analysis, {
    at,
    exit: 0,
    duration_ms: outcome.durationMs,
    input_hashes: inputHashes,
    output_hashes,
    results: results.map((r) => r.id),
  });

  await store.appendEvent({
    ts: clock(),
    op: 'analyze',
    actor,
    ids: [analysis.id, ...create.map((r) => r.id), ...reject.map((r) => r.id)],
    summary:
      `analysis run: ${analysis.name} → ${create.length} new, ` +
      `${keep.length} unchanged, ${reject.length} superseded`,
  });

  return {
    analysis: recorded,
    ran: true,
    run: recorded.runs[recorded.runs.length - 1],
    created: create,
    rejected: reject,
    kept: keep,
  };
}

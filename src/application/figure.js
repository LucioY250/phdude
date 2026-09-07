import { join } from 'node:path';
import { newFigure } from '../domain/entities.js';
import { PhdudeError } from '../domain/errors.js';
import { generatorScript, staleness, validateFigure } from '../domain/figures.js';
import { sha256 } from '../domain/hash.js';
import { parseId } from '../domain/ids.js';
import { stableStringify } from '../domain/normalize.js';
import { assertExecutionAllowed, executionTimeoutMs, runtimeCommand } from '../domain/policy.js';
import { assertUpToDate } from './guard.js';
import { sourceHash } from './table.js';

const POLICY_PATH = join('.phdude', 'research-policy.yaml');
const ALLOWED_FIELDS = ['name', 'caption', 'alt', 'generator', 'inputs', 'outputs'];

function assertKnownFields(fields) {
  const unknown = Object.keys(fields ?? {})
    .filter((key) => !ALLOWED_FIELDS.includes(key))
    .sort();
  if (unknown.length > 0) {
    throw new PhdudeError(
      'VALIDATION',
      `unknown field(s) for figure: ${unknown.join(', ')}`,
      `allowed: ${ALLOWED_FIELDS.join(', ')}`,
    );
  }
}

async function assertInputsExist(store, inputs) {
  for (const id of inputs) {
    if (!(await store.readEntity(id))) {
      throw new PhdudeError(
        'VALIDATION',
        `unknown reference ${id}`,
        'a figure is built from RESULT or DATASET ids that already exist',
      );
    }
  }
}

// The hash of every input as the workspace holds it now, `null` when it no longer holds it at
// all. A dataset hashes to its file's current bytes, which is what makes a figure go stale the
// moment a researcher edits the data under it.
async function currentInputHashes({ store, readBytes }, inputs) {
  const hashes = {};
  for (const id of inputs) {
    const obj = await store.readEntity(id);
    if (obj === null) {
      hashes[id] = null;
      continue;
    }
    const type = parseId(id).type;
    try {
      hashes[id] = await sourceHash({ type, obj }, readBytes);
    } catch (err) {
      if (err.code === 'VALIDATION') hashes[id] = null;
      else throw err;
    }
  }
  return hashes;
}

/**
 * Declares a figure: what generates it, from what, to where, and the sentence a reader who
 * cannot see it needs. The name is the identity, so declaring the same figure again corrects
 * the declaration in place and keeps every run it has been through.
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {{name: string, caption: string, alt: string, generator: object, inputs?: string[],
 *   outputs: object[]}} fields
 * @returns {Promise<{figure: object, created: boolean, changed: boolean}>}
 */
export async function add({ store, clock, actor }, fields) {
  assertUpToDate(await store.readProject());
  assertKnownFields(fields);
  await assertInputsExist(store, validateFigure(fields).inputs);

  const declared = newFigure({ ...fields, actor, created: clock() });
  const existing = await store.readEntity(declared.id);
  if (
    existing &&
    ALLOWED_FIELDS.every((k) => stableStringify(existing[k]) === stableStringify(declared[k]))
  ) {
    return { figure: existing, created: false, changed: false };
  }

  const figure = existing
    ? { ...existing, ...Object.fromEntries(ALLOWED_FIELDS.map((k) => [k, declared[k]])) }
    : declared;

  await store.writeEntity(figure);
  await store.appendEvent({
    ts: clock(),
    op: 'figure',
    actor,
    ids: [figure.id],
    summary: existing ? `figure redeclared: ${figure.name}` : `figure declared: ${figure.name}`,
  });
  return { figure, created: !existing, changed: true };
}

/**
 * @param {{store: object}} deps
 * @returns {Promise<object[]>}
 */
export async function list({ store }) {
  return store.listEntities('figure');
}

/**
 * @param {{store: object}} deps
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function show({ store }, id) {
  if (parseId(id)?.type !== 'figure') {
    throw new PhdudeError('USAGE', `not a figure id: ${id}`, 'phdude figure show <FIG-id>');
  }
  const obj = await store.readEntity(id);
  if (!obj) throw new PhdudeError('USAGE', `not found: ${id}`, 'run phdude figure list');
  return obj;
}

async function recordRun({ store, actor }, figure, run, summary) {
  const withRun = { ...figure, runs: [...figure.runs, run] };
  await store.writeEntity(withRun);
  await store.appendEvent({ ts: run.at, op: 'figure', actor, ids: [figure.id], summary });
  return withRun;
}

/**
 * Runs a figure's generator through the AnalysisRunner and records what it read and what it
 * wrote. A run that fails is still a run: the record keeps its exit code so the next reader can
 * see the figure was attempted and did not render, rather than that it was never tried.
 * @param {{store: object, clock: () => string, actor: object, runner: object,
 *   readBytes: (rel: string) => Promise<Buffer>, generatorsDir: string}} deps
 * @param {string} id
 * @param {{allowExec?: boolean}} [opts]
 * @returns {Promise<{figure: object, run: object,
 *   outputs: {path: string, format: string, hash: string}[]}>}
 */
export async function build(deps, id, { allowExec = false } = {}) {
  const { store, clock, runner, readBytes, generatorsDir } = deps;
  assertUpToDate(await store.readProject());

  const figure = await show(deps, id);
  const policy = await store.readYaml(POLICY_PATH);
  assertExecutionAllowed(policy, { allowExec });

  const resolved = generatorScript(figure.generator.script);
  const script = resolved.shipped ? join(generatorsDir, resolved.shipped) : resolved.path;
  const runtime = runtimeCommand(policy, figure.generator.runtime);
  const timeoutMs = executionTimeoutMs(policy);
  const inputHashes = await currentInputHashes(deps, figure.inputs);

  const result = await runner.run({
    runtime,
    script,
    args: figure.generator.args,
    cwd: store.root,
    env: { PHDUDE_WORKSPACE: store.root, PHDUDE_FIGURE: figure.id },
    timeoutMs,
  });

  const at = clock();
  const failed = {
    at,
    exit: result.exitCode,
    duration_ms: Math.round(result.durationMs),
    input_hashes: inputHashes,
    output_hashes: {},
  };

  if (result.timedOut) {
    await recordRun(deps, figure, failed, `figure timed out: ${figure.name}`);
    throw new PhdudeError(
      'TOOL_MISSING',
      `${figure.name} timed out after ${Math.round(timeoutMs / 1000)}s`,
      'raise execution.timeout_seconds in .phdude/research-policy.yaml, or make the generator do less',
    );
  }

  if (result.exitCode !== 0) {
    await recordRun(
      deps,
      figure,
      failed,
      `figure failed: ${figure.name} (exit ${result.exitCode})`,
    );
    throw new PhdudeError(
      'EXECUTION',
      `${figure.generator.script} exited ${result.exitCode} building ${figure.name}`,
      'fix the generator, then run phdude figure build again',
      (result.stderr || result.stdout).trim().split('\n').filter(Boolean).slice(-10),
    );
  }

  // A generator that exits 0 without writing what it declared has not built the figure, and
  // hashing the outputs that happen to be there would record a run that did not happen.
  const outputs = [];
  const missing = [];
  for (const output of figure.outputs) {
    try {
      outputs.push({ ...output, hash: sha256(await readBytes(output.path)) });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      missing.push(output.path);
    }
  }

  if (missing.length > 0) {
    await recordRun(deps, figure, failed, `figure wrote no output: ${figure.name}`);
    throw new PhdudeError(
      'EXECUTION',
      `${figure.name} exited 0 without writing ${missing.join(', ')}`,
      'the generator writes every path the figure declares under outputs',
    );
  }

  const run = {
    ...failed,
    output_hashes: Object.fromEntries(outputs.map((o) => [o.path, o.hash])),
  };
  const built = await recordRun(
    deps,
    figure,
    run,
    `figure built: ${figure.name} (${outputs.map((o) => o.path).join(', ')})`,
  );
  return { figure: built, run, outputs };
}

/**
 * What is wrong with every figure in the workspace: alt text that is not there, outputs that
 * are not on disk, and inputs that have moved since the run that produced them. It reports; a
 * rebuild is the answer, so nothing here is an error.
 * @param {{store: object, readBytes: (rel: string) => Promise<Buffer>}} deps
 * @returns {Promise<{figures: object[], findings: number}>}
 */
export async function check(deps) {
  const { store } = deps;
  const figures = [];
  for (const figure of await store.listEntities('figure')) {
    const present = {};
    for (const output of figure.outputs ?? []) {
      present[output.path] = await store.exists(output.path);
    }
    figures.push(
      staleness(figure, {
        inputHashes: await currentInputHashes(deps, figure.inputs ?? []),
        present,
      }),
    );
  }
  return { figures, findings: figures.reduce((n, f) => n + f.findings.length, 0) };
}

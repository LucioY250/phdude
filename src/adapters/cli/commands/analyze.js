import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import * as analyze from '../../../application/analyze.js';
import { PhdudeError } from '../../../domain/errors.js';
import { parseJsonArg } from '../args.js';

const ADD_USAGE =
  `phdude analyze add --json '{"name":"describe survey","runtime":"node",` +
  `"script":"analysis/describe.mjs","inputs":["DATASET-…"]}'`;

async function readSpec({ flags, cwd }) {
  if (flags.jsonPayload) return parseJsonArg(flags.jsonPayload, '--json');
  if (flags.file) {
    const path = resolve(cwd, flags.file);
    let text;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      throw new PhdudeError('USAGE', `cannot read ${flags.file}: ${err.message}`);
    }
    return parseJsonArg(text, `--file ${flags.file}`);
  }
  throw new PhdudeError('USAGE', 'analyze add needs a declaration', ADD_USAGE);
}

function column(values, min = 0) {
  return Math.max(min, ...values.map((v) => String(v).length));
}

function lastRun(analysis) {
  return analysis.runs.length === 0 ? null : analysis.runs[analysis.runs.length - 1];
}

// A run with no exit code was ended by a signal, not by the script. Both `runState` and the run
// table say so, because "exit null" reads as a run that returned nothing rather than one that was
// killed before it could return anything.
function killedBy(run, joiner) {
  return `killed${run.signal ? `${joiner}${run.signal}` : ''}`;
}

function runState(analysis) {
  const last = lastRun(analysis);
  if (last === null) return 'never run';
  if (last.timed_out === true) return 'timed out';
  if (last.exit === null) return killedBy(last, ' by ');
  return last.exit === 0 ? `ran ${last.at}` : `failed (exit ${last.exit})`;
}

function renderList(analyses) {
  if (analyses.length === 0) return '(no analyses)\n';
  const nameWidth = column(analyses.map((a) => a.name));
  const runtimeWidth = column(analyses.map((a) => a.runtime));
  const lines = analyses.map((a) => {
    const inputs = `${a.inputs.length} input(s)`;
    return `${a.id}  ${a.name.padEnd(nameWidth)}  ${a.runtime.padEnd(runtimeWidth)}  ${a.script}  ${inputs}  ${runState(a)}`;
  });
  lines.push('', `${analyses.length} ${analyses.length === 1 ? 'analysis' : 'analyses'}`);
  return lines.join('\n') + '\n';
}

function renderRuns({ id, name, runs }) {
  const header = [`${id}  ${name}`, ''];
  if (runs.length === 0) return header.concat('(never run)', '').join('\n');

  const rows = runs.map((run) => {
    const status =
      run.timed_out === true
        ? 'timed out'
        : run.exit === null
          ? killedBy(run, ' ')
          : `exit ${run.exit}`;
    const results = `${run.results.length} result(s)`;
    const outputs = `${Object.keys(run.output_hashes).length} output(s)`;
    return `${run.at}  ${status.padEnd(9)}  ${String(run.duration_ms).padStart(7)}ms  ${results}  ${outputs}`;
  });
  const tails = runs
    .filter((run) => typeof run.stderr_tail === 'string' && run.stderr_tail.trim() !== '')
    .map((run) => `\n${run.at} stderr:\n${run.stderr_tail.trimEnd()}`);
  return header.concat(rows, tails, '').join('\n');
}

function renderRun(outcome) {
  const { analysis } = outcome;
  if (!outcome.ran) {
    return [
      `${analysis.id} is ${outcome.reason}: no input has changed since the last successful run.`,
      'Run it anyway with --force.',
      '',
    ].join('\n');
  }

  const lines = [
    `Ran ${analysis.id} (${analysis.name}) in ${outcome.run.duration_ms}ms: ` +
      `${outcome.created.length} new, ${outcome.kept.length} unchanged, ${outcome.rejected.length} superseded`,
    '',
  ];
  for (const result of outcome.created) lines.push(`  + ${result.id}  ${result.summary}`);
  for (const result of outcome.rejected) {
    lines.push(`  - ${result.id}  superseded by ${result.superseded_by}`);
  }
  for (const result of outcome.kept) lines.push(`  = ${result.id}  ${result.summary}`);
  lines.push('');
  return lines.join('\n');
}

export default async function analyzeCommand(ctx) {
  const { sub, positionals, flags, deps } = ctx;
  const storeDeps = { store: deps.store };

  if (sub === 'add') {
    const { analysis, created, changed } = await analyze.add(
      { store: deps.store, clock: deps.clock, actor: deps.actor },
      await readSpec(ctx),
    );
    const shape = `${analysis.runtime} ${analysis.script} on ${analysis.inputs.length} dataset(s)`;
    const verb = created ? 'Declared' : changed ? 'Updated' : 'Unchanged';
    return {
      text: `${verb} ${analysis.id} (${analysis.name}: ${shape})\n`,
      json: { analysis, created, changed },
    };
  }

  if (sub === 'run') {
    const id = positionals[2];
    if (!id) {
      throw new PhdudeError(
        'USAGE',
        'analyze run needs an id',
        'phdude analyze run <ANALYSIS-id> [--allow-exec] [--force]',
      );
    }
    const outcome = await analyze.run(
      {
        store: deps.store,
        clock: deps.clock,
        actor: deps.actor,
        runner: deps.runner,
        readBytes: deps.readBytes,
      },
      { id, allowExec: flags.allowExec, force: flags.force },
    );
    return { text: renderRun(outcome), json: outcome };
  }

  if (sub === 'runs') {
    const id = positionals[2];
    if (!id) {
      throw new PhdudeError(
        'USAGE',
        'analyze runs needs an id',
        'phdude analyze runs <ANALYSIS-id>',
      );
    }
    const history = await analyze.runs(storeDeps, id);
    return { text: renderRuns(history), json: history };
  }

  if (sub === 'show') {
    const id = positionals[2];
    if (!id) {
      throw new PhdudeError(
        'USAGE',
        'analyze show needs an id',
        'phdude analyze show <ANALYSIS-id>',
      );
    }
    const analysis = await analyze.show(storeDeps, id);
    return { text: stringify(analysis, { lineWidth: 0 }), json: analysis };
  }

  if (sub === 'list' || sub === null) {
    const analyses = await analyze.list(storeDeps);
    return { text: renderList(analyses), json: analyses };
  }

  throw new PhdudeError(
    'USAGE',
    `unknown analyze subcommand: ${sub}`,
    'phdude analyze add --json | list | show <id> | run <id> | runs <id>',
  );
}

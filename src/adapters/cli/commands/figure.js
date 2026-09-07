import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import * as figure from '../../../application/figure.js';
import { PhdudeError } from '../../../domain/errors.js';
import { parseJsonArg } from '../args.js';

async function readFields({ flags, cwd }) {
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
  throw new PhdudeError(
    'USAGE',
    'figure add needs a declaration',
    `phdude figure add --json '{"name":"mean-weight","caption":"…","alt":"…",` +
      `"generator":{"runtime":"node","script":"phdude:bar-chart","args":[…]},` +
      `"inputs":["RESULT-…"],"outputs":[{"path":"figures/out/mean-weight.svg","format":"svg"}]}'` +
      ` (or --file figure.json)`,
  );
}

function renderList(figures) {
  if (figures.length === 0) return '(no figures)\n';
  const width = Math.max(...figures.map((f) => f.name.length));
  const lines = figures.map((f) => {
    const last = f.runs.at(-1);
    const state = !last
      ? 'never built'
      : last.exit === 0
        ? `built ${last.at}`
        : `failed ${last.at}`;
    return `${f.id}  ${f.name.padEnd(width)}  ${f.generator.script}  ${state}`;
  });
  lines.push('', `${figures.length} figure(s)`);
  return lines.join('\n') + '\n';
}

const FINDING_TEXT = {
  'missing-alt': () => 'no alt text; a figure without one cannot be published (PRD §100)',
  'never-run': () => 'never built',
  'missing-output': (f) => `output missing: ${f.path}`,
  'missing-input': (f) => `input gone: ${f.input}`,
  'stale-input': (f) => `input changed since the last build: ${f.input}`,
};

function renderCheck(report) {
  if (report.figures.length === 0) return '(no figures)\n';
  const lines = [];
  for (const fig of report.figures) {
    lines.push(`${fig.id}  ${fig.name}  ${fig.status}`);
    for (const finding of fig.findings) lines.push(`  - ${FINDING_TEXT[finding.kind](finding)}`);
  }
  lines.push(
    '',
    report.findings === 0
      ? `${report.figures.length} figure(s), nothing to do`
      : `${report.figures.length} figure(s), ${report.findings} finding(s)`,
  );
  return lines.join('\n') + '\n';
}

export default async function figureCommand(ctx) {
  const { sub, positionals, flags, deps } = ctx;
  const storeDeps = { store: deps.store };

  if (sub === 'add') {
    const result = await figure.add(
      { store: deps.store, clock: deps.clock, actor: deps.actor, realpath: deps.fs.realpath },
      await readFields(ctx),
    );
    const what = result.created ? 'Declared' : result.changed ? 'Redeclared' : 'Unchanged';
    const outputs = result.figure.outputs.map((o) => o.path).join(', ');
    return {
      text: `${what} ${result.figure.id} (${result.figure.name} → ${outputs})\n`,
      json: result,
    };
  }

  if (sub === 'list' || sub === null) {
    const figures = await figure.list(storeDeps);
    return { text: renderList(figures), json: figures };
  }

  if (sub === 'show') {
    const id = positionals[2];
    if (!id) {
      throw new PhdudeError('USAGE', 'figure show needs an id', 'phdude figure show <FIG-id>');
    }
    const found = await figure.show(storeDeps, id);
    return { text: stringify(found, { lineWidth: 0 }), json: found };
  }

  if (sub === 'build') {
    const id = positionals[2];
    if (!id) {
      throw new PhdudeError('USAGE', 'figure build needs an id', 'phdude figure build <FIG-id>');
    }
    const result = await figure.build(
      {
        store: deps.store,
        clock: deps.clock,
        actor: deps.actor,
        runner: deps.runner,
        readBytes: deps.readBytes,
        realpath: deps.fs.realpath,
        generatorsDir: deps.generatorsDir,
      },
      id,
      { allowExec: flags.allowExec, force: flags.force },
    );
    if (!result.built) {
      return {
        text:
          `${result.figure.id} is ${result.reason}: nothing has changed since the last build.\n` +
          'Build it anyway with --force.\n',
        json: result,
      };
    }
    const written = result.outputs.map((o) => `  ${o.path}`).join('\n');
    return {
      text: `Built ${result.figure.name} in ${result.run.duration_ms}ms\n${written}\n`,
      json: result,
    };
  }

  if (sub === 'check') {
    const report = await figure.check({ store: deps.store, readBytes: deps.readBytes });
    return { text: renderCheck(report), json: report };
  }

  throw new PhdudeError(
    'USAGE',
    `unknown figure subcommand: ${sub}`,
    'phdude figure add --json <decl> | list | show <id> | build <id> | check',
  );
}

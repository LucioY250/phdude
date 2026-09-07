import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import * as data from '../../../application/data.js';
import { PhdudeError } from '../../../domain/errors.js';
import { parseJsonArg } from '../args.js';

async function readMeta({ flags, cwd }) {
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
  return {};
}

function column(values, min = 0) {
  return Math.max(min, ...values.map((v) => String(v).length));
}

function renderList(datasets) {
  if (datasets.length === 0) return '(no datasets)\n';
  const pathWidth = column(datasets.map((d) => d.path));
  const lines = datasets.map((d) => {
    const shape = `${d.profile.rows} row(s), ${d.profile.columns.length} column(s)`;
    const superseded = d.latest === false ? '  (superseded)' : '';
    return `${d.id}  ${d.path.padEnd(pathWidth)}  ${d.format.padEnd(5)}  ${shape}${superseded}`;
  });
  lines.push('', `${datasets.length} dataset(s)`);
  return lines.join('\n') + '\n';
}

function renderProfile(profile) {
  const header = [`${profile.id}  ${profile.path}  ${profile.format}  ${profile.rows} row(s)`, ''];
  if (profile.columns.length === 0) {
    return header.concat('(no columns profiled)', '').join('\n');
  }

  const withSamples = profile.columns.some((c) => Object.hasOwn(c, 'samples'));
  const nameWidth = column([...profile.columns.map((c) => c.name), 'Column']);
  const typeWidth = column([...profile.columns.map((c) => c.inferred_type), 'Type']);
  const row = (name, type, missing, distinct, samples) =>
    [
      name.padEnd(nameWidth),
      type.padEnd(typeWidth),
      String(missing).padStart(7),
      String(distinct).padStart(8),
      ...(withSamples ? [samples] : []),
    ]
      .join('  ')
      .trimEnd();

  const rows = profile.columns.map((c) =>
    row(
      c.name,
      c.inferred_type,
      c.missing,
      `${c.distinct}${c.distinct_truncated ? '+' : ''}`,
      (c.samples ?? []).join(', '),
    ),
  );
  return header
    .concat(row('Column', 'Type', 'Missing', 'Distinct', 'Samples'), ...rows, '')
    .join('\n');
}

export default async function dataCommand(ctx) {
  const { sub, positionals, deps } = ctx;
  const storeDeps = { store: deps.store };

  if (sub === 'add') {
    const path = positionals[2];
    if (!path) {
      throw new PhdudeError(
        'USAGE',
        'data add needs a path under data/',
        `phdude data add data/survey.csv [--json '{"sensitive":true}']`,
      );
    }
    const { dataset, created, replaced } = await data.add(
      {
        store: deps.store,
        clock: deps.clock,
        actor: deps.actor,
        readBytes: deps.readBytes,
        realpath: deps.fs.realpath,
        parseTable: deps.parseTable,
      },
      path,
      await readMeta(ctx),
    );
    const shape = `${dataset.format}, ${dataset.profile.rows} row(s), ${dataset.profile.columns.length} column(s)`;
    if (!created) {
      return {
        text: `Unchanged ${dataset.id} (${dataset.path})\n`,
        json: { dataset, created, replaced },
      };
    }
    const version = replaced.length > 0 ? `, new version of ${replaced.join(', ')}` : '';
    return {
      text: `Added ${dataset.id} (${dataset.path}: ${shape})${version}\n`,
      json: { dataset, created, replaced },
    };
  }

  if (sub === 'list' || sub === null) {
    const datasets = await data.list(storeDeps);
    return { text: renderList(datasets), json: datasets };
  }

  if (sub === 'show') {
    const id = positionals[2];
    if (!id) {
      throw new PhdudeError('USAGE', 'data show needs an id', 'phdude data show <DATASET-id>');
    }
    const dataset = await data.show(storeDeps, id);
    return { text: stringify(dataset, { lineWidth: 0 }), json: dataset };
  }

  if (sub === 'profile') {
    const id = positionals[2];
    if (!id) {
      throw new PhdudeError(
        'USAGE',
        'data profile needs an id',
        'phdude data profile <DATASET-id>',
      );
    }
    const profile = await data.profile(storeDeps, id);
    return { text: renderProfile(profile), json: profile };
  }

  throw new PhdudeError(
    'USAGE',
    `unknown data subcommand: ${sub}`,
    'phdude data add <path> | list | show <id> | profile <id>',
  );
}

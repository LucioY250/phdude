import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import * as table from '../../../application/table.js';
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
    'table add needs a declaration',
    `phdude table add --json '{"name":"mean-weight","caption":"…","source":{"result":"RESULT-…"}}'`,
  );
}

function sourceOf(t) {
  if (t.source.result) return t.source.result;
  const narrowing = [
    t.source.columns ? `columns ${t.source.columns.join('/')}` : null,
    t.source.limit ? `limit ${t.source.limit}` : null,
  ].filter(Boolean);
  return narrowing.length > 0 ? `${t.source.dataset} (${narrowing.join(', ')})` : t.source.dataset;
}

function renderList(tables) {
  if (tables.length === 0) return '(no tables)\n';
  const width = Math.max(...tables.map((t) => t.name.length));
  const lines = tables.map((t) => {
    const runs = t.runs.length === 0 ? 'never built' : `built ${t.runs.at(-1).at}`;
    return `${t.id}  ${t.name.padEnd(width)}  ${t.formats.join(',').padEnd(12)}  ${sourceOf(t)}  ${runs}`;
  });
  lines.push('', `${tables.length} table(s)`);
  return lines.join('\n') + '\n';
}

export default async function tableCommand(ctx) {
  const { sub, positionals, flags, deps } = ctx;
  const storeDeps = { store: deps.store };

  if (sub === 'add') {
    const result = await table.add(
      { store: deps.store, clock: deps.clock, actor: deps.actor },
      await readFields(ctx),
    );
    const what = result.created ? 'Declared' : result.changed ? 'Redeclared' : 'Unchanged';
    return {
      text: `${what} ${result.table.id} (${result.table.name}: ${result.table.formats.join(', ')})\n`,
      json: result,
    };
  }

  if (sub === 'list' || sub === null) {
    const tables = await table.list(storeDeps);
    return { text: renderList(tables), json: tables };
  }

  if (sub === 'show') {
    const id = positionals[2];
    if (!id) {
      throw new PhdudeError('USAGE', 'table show needs an id', 'phdude table show <TABLE-id>');
    }
    const found = await table.show(storeDeps, id);
    return { text: stringify(found, { lineWidth: 0 }), json: found };
  }

  if (sub === 'build') {
    const id = positionals[2];
    if (!id) {
      throw new PhdudeError('USAGE', 'table build needs an id', 'phdude table build <TABLE-id>');
    }
    const formats = flags.format
      ? flags.format
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean)
      : undefined;
    const result = await table.build(
      {
        store: deps.store,
        clock: deps.clock,
        actor: deps.actor,
        readBytes: deps.readBytes,
        parseTable: deps.parseTable,
        writeXlsx: deps.writeXlsx,
        renderers: deps.renderers,
      },
      id,
      { formats, force: flags.force },
    );
    if (!result.built) {
      return {
        text: `${result.table.name} is up to date (${result.outputs.map((o) => o.path).join(', ')})\n`,
        json: result,
      };
    }
    const written = result.outputs.map((o) => `  ${o.path}`).join('\n');
    return { text: `Built ${result.table.name}\n${written}\n`, json: result };
  }

  throw new PhdudeError(
    'USAGE',
    `unknown table subcommand: ${sub}`,
    'phdude table add --json <decl> | list | show <id> | build <id>',
  );
}

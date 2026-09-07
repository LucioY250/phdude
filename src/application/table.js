import { newTable } from '../domain/entities.js';
import { PhdudeError } from '../domain/errors.js';
import { sha256 } from '../domain/hash.js';
import { parseId } from '../domain/ids.js';
import { stableStringify } from '../domain/normalize.js';
import { renderTable, rowsFrom, tableFormats, tableOutputs } from '../domain/tables.js';
import { assertUpToDate } from './guard.js';

const ALLOWED_FIELDS = ['name', 'caption', 'source', 'columns', 'formats'];
const DEFINITION_FIELDS = ['name', 'caption', 'source', 'columns', 'formats', 'outputs'];
const NARROWING_FIELDS = ['columns', 'limit'];

function assertKnownFields(fields) {
  const unknown = Object.keys(fields ?? {})
    .filter((key) => !ALLOWED_FIELDS.includes(key))
    .sort();
  if (unknown.length > 0) {
    throw new PhdudeError(
      'VALIDATION',
      `unknown field(s) for table: ${unknown.join(', ')}`,
      `allowed: ${ALLOWED_FIELDS.join(', ')}`,
    );
  }
}

function assertSourceShape(source) {
  const hasResult = typeof source?.result === 'string';
  const hasDataset = typeof source?.dataset === 'string';
  if (hasResult === hasDataset) {
    throw new PhdudeError(
      'VALIDATION',
      'a table source names exactly one of result or dataset',
      `source: {"result":"RESULT-…"} or {"dataset":"DATASET-…","columns":[…],"limit":n}`,
    );
  }
  // `columns` and `limit` narrow a table read from a file. On a result there is nothing to
  // narrow, and accepting them would leave a declaration that says something the build ignores.
  const narrowing = NARROWING_FIELDS.filter((key) => source[key] !== undefined);
  if (hasResult && narrowing.length > 0) {
    throw new PhdudeError(
      'VALIDATION',
      `${narrowing.join(' and ')} only apply to a dataset source`,
      'a result table renders every value the analysis recorded',
    );
  }
  const type = hasResult ? 'result' : 'dataset';
  const id = hasResult ? source.result : source.dataset;
  if (parseId(id)?.type !== type) {
    throw new PhdudeError('VALIDATION', `not a ${type} id: ${id}`, `source.${type} takes one id`);
  }
  return { type, id };
}

async function readSource(store, source) {
  const { type, id } = assertSourceShape(source);
  const obj = await store.readEntity(id);
  if (!obj) {
    throw new PhdudeError(
      'VALIDATION',
      `unknown reference ${id}`,
      type === 'result' ? 'run phdude knowledge list --type result' : 'run phdude data list',
    );
  }
  return { type, obj };
}

/**
 * The hash a run records for what it read. A dataset's is the bytes on disk right now, not the
 * bytes recorded when it was registered: editing the file is exactly what has to make everything
 * built from it stale, and nothing watches the file for that to happen.
 * @param {{type: 'result'|'dataset', obj: object}} source
 * @param {(rel: string) => Promise<Buffer>} readBytes
 * @returns {Promise<string>}
 */
export async function sourceHash({ type, obj }, readBytes) {
  if (type !== 'dataset') return sha256(stableStringify(obj.values ?? {}));
  try {
    return sha256(await readBytes(obj.path));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new PhdudeError(
        'VALIDATION',
        `file not found: ${obj.path}`,
        `${obj.id} points at a file that is no longer there`,
      );
    }
    throw err;
  }
}

async function readSourceRows({ store, readBytes, parseTable }, table) {
  const source = await readSource(store, table.source);
  const hash = await sourceHash(source, readBytes);
  if (source.type !== 'dataset') {
    return { hash, ...rowsFrom(table.source, { result: source.obj }) };
  }
  const bytes = await readBytes(source.obj.path);
  const parsed = await parseTable(bytes, source.obj.format);
  return { hash, ...rowsFrom(table.source, { dataset: source.obj, table: parsed }) };
}

function sameDefinition(a, b) {
  return DEFINITION_FIELDS.every((key) => stableStringify(a[key]) === stableStringify(b[key]));
}

/**
 * Declares a table: which source it renders, which columns, in which formats. The name is the
 * identity, so declaring the same table again corrects the declaration in place rather than
 * minting a second record whose output files would land on the first one's.
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {{name: string, caption: string, source: object, columns?: object[],
 *   formats?: string[]}} fields
 * @returns {Promise<{table: object, created: boolean, changed: boolean}>}
 */
export async function add({ store, clock, actor }, fields) {
  assertUpToDate(await store.readProject());
  assertKnownFields(fields);
  await readSource(store, fields.source);

  const declared = newTable({ ...fields, actor, created: clock() });
  const existing = await store.readEntity(declared.id);
  if (existing && sameDefinition(existing, declared)) {
    return { table: existing, created: false, changed: false };
  }

  // A re-declaration keeps everything the declaration does not own: when the table was first
  // recorded, who recorded it, its state, and every build it has been through.
  const table = existing
    ? {
        ...existing,
        ...Object.fromEntries(DEFINITION_FIELDS.map((key) => [key, declared[key]])),
      }
    : declared;

  await store.writeEntity(table);
  await store.appendEvent({
    ts: clock(),
    op: 'table',
    actor,
    ids: [table.id],
    summary: existing ? `table redeclared: ${table.name}` : `table declared: ${table.name}`,
  });
  return { table, created: !existing, changed: true };
}

/**
 * @param {{store: object}} deps
 * @returns {Promise<object[]>}
 */
export async function list({ store }) {
  return store.listEntities('table');
}

/**
 * @param {{store: object}} deps
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function show({ store }, id) {
  if (parseId(id)?.type !== 'table') {
    throw new PhdudeError('USAGE', `not a table id: ${id}`, 'phdude table show <TABLE-id>');
  }
  const obj = await store.readEntity(id);
  if (!obj) throw new PhdudeError('USAGE', `not found: ${id}`, 'run phdude table list');
  return obj;
}

function requestedFormats(table, formats) {
  const wanted = tableFormats(formats);
  const undeclared = wanted.filter((f) => !table.formats.includes(f));
  if (formats !== undefined && formats.length > 0 && undeclared.length > 0) {
    throw new PhdudeError(
      'VALIDATION',
      `${table.name} does not declare format(s): ${undeclared.join(', ')}`,
      `it declares ${table.formats.join(', ')}`,
    );
  }
  return wanted.filter((f) => table.formats.includes(f));
}

/**
 * Renders a table from its source and records what it read and what it wrote. A build whose
 * source has not moved and whose output files already hold exactly these bytes is reported as
 * up to date: it writes nothing and records nothing, so a rebuild loop leaves no history of
 * runs that changed nothing. `--force` builds anyway.
 * @param {{store: object, clock: () => string, actor: object,
 *   readBytes: (rel: string) => Promise<Buffer>,
 *   parseTable: (bytes: Buffer, format: string) => Promise<string[][]|null>}} deps
 * @param {string} id
 * @param {{formats?: string[], force?: boolean}} [opts]
 * @returns {Promise<{table: object, built: boolean, reason: string|null, sourceHash: string,
 *   outputs: {format: string, path: string, hash: string}[]}>}
 */
export async function build(deps, id, { formats, force = false } = {}) {
  const { store, clock, actor } = deps;
  assertUpToDate(await store.readProject());

  const table = await show(deps, id);
  const wanted = requestedFormats(table, formats);
  const { hash, columns, rows } = await readSourceRows(deps, table);

  const spec = {
    name: table.name,
    caption: table.caption,
    columns: table.columns.length > 0 ? table.columns : columns,
  };
  const outputs = wanted.map((format) => {
    const text = renderTable(spec, rows, format);
    return { format, path: table.outputs[format], text, hash: sha256(text) };
  });

  const lastRun = table.runs.at(-1) ?? null;
  const unchanged =
    !force &&
    lastRun !== null &&
    lastRun.source_hash === hash &&
    (await Promise.all(outputs.map((o) => store.readText(o.path)))).every(
      (onDisk, i) => onDisk === outputs[i].text,
    );
  if (unchanged) {
    return {
      table,
      built: false,
      reason: 'up to date',
      sourceHash: hash,
      outputs: outputs.map(({ format, path, hash: h }) => ({ format, path, hash: h })),
    };
  }

  for (const output of outputs) await store.writeTextAtomic(output.path, output.text);

  const at = clock();
  const built = {
    ...table,
    runs: [
      ...table.runs,
      {
        at,
        source_hash: hash,
        output_hashes: Object.fromEntries(outputs.map((o) => [o.path, o.hash])),
      },
    ],
  };
  await store.writeEntity(built);
  await store.appendEvent({
    ts: at,
    op: 'table',
    actor,
    ids: [table.id],
    summary: `table built: ${table.name} (${wanted.join(', ')})`,
  });

  return {
    table: built,
    built: true,
    reason: null,
    sourceHash: hash,
    outputs: outputs.map(({ format, path, hash: h }) => ({ format, path, hash: h })),
  };
}

export { tableOutputs };

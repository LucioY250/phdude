import { resolve } from 'node:path';
import {
  datasetFormat,
  datasetPath,
  linkDatasetVersions,
  profileTable,
} from '../domain/datasets.js';
import { newDataset } from '../domain/entities.js';
import { PhdudeError } from '../domain/errors.js';
import { sha256 } from '../domain/hash.js';
import { makeHashId, parseId } from '../domain/ids.js';
import { assertUpToDate } from './guard.js';
import { assertRealPathInsideRoot } from './paths.js';

const ALLOWED_META = ['description', 'license', 'sensitive'];

function assertKnownMeta(meta) {
  const unknown = Object.keys(meta ?? {})
    .filter((key) => !ALLOWED_META.includes(key))
    .sort();
  if (unknown.length > 0) {
    throw new PhdudeError(
      'VALIDATION',
      `unknown field(s) for dataset: ${unknown.join(', ')}`,
      `allowed: ${ALLOWED_META.join(', ')}`,
    );
  }
}

async function readDatasetBytes(readBytes, rel) {
  try {
    return await readBytes(rel);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new PhdudeError(
        'VALIDATION',
        `file not found: ${rel}`,
        'put the file under data/ first',
      );
    }
    if (err.code === 'EISDIR') {
      throw new PhdudeError(
        'VALIDATION',
        `not a file: ${rel}`,
        'a dataset is one file under data/',
      );
    }
    throw err;
  }
}

function byCreated(a, b) {
  if (a.created !== b.created) return a.created < b.created ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Registers a file under `data/` as a dataset: its bytes are its identity, its extension its
 * format, and its parsed table its profile. Adding the same bytes again changes nothing;
 * adding changed bytes at the same path records a new dataset linked back to the first, so the
 * analyses that cite the old one still say which data they ran on.
 * @param {{store: object, clock: () => string, actor: object,
 *   readBytes: (rel: string) => Promise<Buffer>,
 *   realpath: (path: string) => Promise<string>,
 *   parseTable: (bytes: Buffer, format: string) => Promise<string[][]|null>}} deps
 * @param {string} path - workspace-relative, under `data/`
 * @param {{description?: string, license?: string, sensitive?: boolean}} [meta]
 * @returns {Promise<{dataset: object, created: boolean, replaced: string[]}>}
 */
export async function add(
  { store, clock, actor, readBytes, realpath, parseTable },
  path,
  meta = {},
) {
  assertUpToDate(await store.readProject());
  assertKnownMeta(meta);

  const rel = datasetPath(path);
  await assertRealPathInsideRoot(
    { realpath },
    store.root,
    path,
    resolve(store.root, rel),
    'a dataset is a file under data/, not a link to one outside the workspace',
  );
  const bytes = await readDatasetBytes(readBytes, rel);
  const hash = sha256(bytes);

  // The bytes are the identity, so a re-add is answered before the file is parsed at all.
  const recorded = await store.readEntity(makeHashId('dataset', hash));
  if (recorded) return { dataset: recorded, created: false, replaced: [] };

  const format = datasetFormat(rel);
  const sensitive = meta.sensitive === true;
  const candidate = newDataset({
    path: rel,
    hash,
    bytes: bytes.length,
    format,
    profile: profileTable(await parseTable(bytes, format), { sensitive }),
    description: meta.description,
    license: meta.license,
    sensitive,
    actor,
    created: clock(),
  });

  const samePath = (await store.listEntities('dataset'))
    .filter((d) => d.path === rel)
    .sort(byCreated);
  const { dataset, updated } = linkDatasetVersions(samePath, candidate);

  await store.writeEntity(dataset);
  for (const obj of updated) await store.writeEntity(obj);
  await store.appendEvent({
    ts: clock(),
    op: 'data',
    actor,
    ids: [dataset.id, ...updated.map((d) => d.id)],
    summary: updated.length === 0 ? `dataset added: ${rel}` : `dataset version added: ${rel}`,
  });

  return { dataset, created: true, replaced: updated.map((d) => d.id) };
}

/**
 * @param {{store: object}} deps
 * @returns {Promise<object[]>} every dataset, by id
 */
export async function list({ store }) {
  return store.listEntities('dataset');
}

/**
 * @param {{store: object}} deps
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function show({ store }, id) {
  if (parseId(id)?.type !== 'dataset') {
    throw new PhdudeError('USAGE', `not a dataset id: ${id}`, 'phdude data show <DATASET-id>');
  }
  const obj = await store.readEntity(id);
  if (!obj) throw new PhdudeError('USAGE', `not found: ${id}`, 'run phdude data list');
  return obj;
}

/**
 * @param {{store: object}} deps
 * @param {string} id
 * @returns {Promise<{id: string, path: string, format: string, sensitive: boolean,
 *   rows: number, columns: object[]}>}
 */
export async function profile(deps, id) {
  const dataset = await show(deps, id);
  return {
    id: dataset.id,
    path: dataset.path,
    format: dataset.format,
    sensitive: dataset.sensitive,
    ...dataset.profile,
  };
}

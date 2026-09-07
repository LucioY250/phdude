import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { assertValid } from '../../schemas/index.js';
import { PhdudeError } from '../../domain/errors.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DEFAULT_PACKS_DIR = join(PACKAGE_ROOT, 'packs');

const KIND_DIRS = ['fields', 'methods', 'venues'];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * @param {string} dir
 * @returns {Promise<object>} the pack, plus `dir` and absolute `skillPaths`
 */
export async function loadPack(dir) {
  const text = await readFile(join(dir, 'pack.yaml'), 'utf8');
  const pack = parse(text);
  assertValid('pack', pack);

  const skillPaths = [];
  for (const rel of pack.skills) {
    const abs = resolve(dir, rel);
    const relBack = relative(dir, abs);
    if (isAbsolute(rel) || relBack === '' || relBack.startsWith('..') || isAbsolute(relBack)) {
      throw new PhdudeError(
        'VALIDATION',
        `pack ${pack.name}: skill path escapes the pack directory: ${rel}`,
      );
    }
    if (!(await exists(abs))) {
      throw new PhdudeError('VALIDATION', `pack ${pack.name}: missing skill file ${rel}`);
    }
    skillPaths.push(abs);
  }

  return { ...pack, dir, skillPaths };
}

async function listPackDirs(root) {
  const dirs = [];
  for (const kindDir of KIND_DIRS) {
    let entries;
    try {
      entries = await readdir(join(root, kindDir), { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, kindDir, entry.name);
      if (await exists(join(dir, 'pack.yaml'))) dirs.push(dir);
    }
  }
  return dirs;
}

/**
 * Discovers packs across `roots` in order; a later root's pack overrides an earlier one with
 * the same `name`.
 * @param {string[]} roots
 * @returns {Promise<object[]>} packs sorted by name
 */
export async function discoverPacks(roots) {
  const byName = new Map();
  for (const root of roots) {
    for (const dir of await listPackDirs(root)) {
      const pack = await loadPack(dir);
      byName.set(pack.name, pack);
    }
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

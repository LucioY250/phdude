import { readFile, readdir, realpath, stat } from 'node:fs/promises';
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

function escapes(relBack) {
  return relBack === '' || relBack.startsWith('..') || isAbsolute(relBack);
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
  const realDir = await realpath(dir);
  for (const rel of pack.skills) {
    if (rel.includes('\0')) {
      throw new PhdudeError(
        'VALIDATION',
        `pack ${pack.name}: skill path contains a NUL byte`,
        'remove the NUL byte from pack.yaml',
      );
    }
    const abs = resolve(dir, rel);
    if (isAbsolute(rel) || escapes(relative(dir, abs))) {
      throw new PhdudeError(
        'VALIDATION',
        `pack ${pack.name}: skill path escapes the pack directory: ${rel}`,
      );
    }
    if (!(await exists(abs))) {
      throw new PhdudeError('VALIDATION', `pack ${pack.name}: missing skill file ${rel}`);
    }
    // The lexical check above cannot see a symlink inside the pack dir pointing out of it.
    if (escapes(relative(realDir, await realpath(abs)))) {
      throw new PhdudeError(
        'VALIDATION',
        `pack ${pack.name}: skill path escapes the pack directory: ${rel}`,
      );
    }
    skillPaths.push(abs);
  }

  return { ...pack, dir, skillPaths };
}

/**
 * A venue profile: the sections a venue expects and the word limit on each (spec §3.4, gate 6).
 * It lives beside a venue pack rather than inside `pack.yaml` because a profile is validation
 * data, not a skill bundle, and v0.6 will ship many of them against one loader.
 * @param {string} name
 * @param {string[]} [roots] - searched in order; a later root overrides an earlier one
 * @returns {Promise<object|null>} the profile, or null when the venue ships none
 */
export async function loadProfile(name, roots = [DEFAULT_PACKS_DIR]) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(name ?? ''))) {
    throw new PhdudeError(
      'VALIDATION',
      `invalid venue profile name: ${name}`,
      'a profile name is lowercase words joined by "-"',
    );
  }

  let found = null;
  for (const root of roots) {
    const path = join(root, 'venues', name, 'profile.yaml');
    if (await exists(path)) found = path;
  }
  if (found === null) return null;

  const profile = parse(await readFile(found, 'utf8'));
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new PhdudeError('VALIDATION', `malformed venue profile: ${name}`, 'fix profile.yaml');
  }
  if (!Array.isArray(profile.sections)) {
    throw new PhdudeError(
      'VALIDATION',
      `venue profile ${name} has no sections list`,
      'a profile lists the sections the venue expects, in order',
    );
  }
  return { ...profile, name: profile.name ?? name };
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

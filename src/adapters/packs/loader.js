import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { assertValid, validateProfile } from '../../schemas/index.js';
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

const VENUE_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertVenueName(name) {
  if (!VENUE_NAME_RE.test(String(name ?? ''))) {
    throw new PhdudeError(
      'VALIDATION',
      `invalid venue profile name: ${name}`,
      'a profile name is lowercase words joined by "-"',
    );
  }
}

// A path a profile points at - its CSL style, its templates - is resolved the way a pack's skill
// paths are: inside the pack directory or not at all. A profile is data a workspace can supply,
// so a path in it must not be able to name a file elsewhere on the machine.
async function resolveInPack(dir, name, rel, what) {
  if (typeof rel !== 'string' || rel.trim() === '') return null;
  if (rel.includes('\0')) {
    throw new PhdudeError(
      'VALIDATION',
      `venue profile ${name}: ${what} path contains a NUL byte`,
      'remove the NUL byte from profile.yaml',
    );
  }
  const abs = resolve(dir, rel);
  if (isAbsolute(rel) || escapes(relative(dir, abs))) {
    throw new PhdudeError(
      'VALIDATION',
      `venue profile ${name}: ${what} path escapes the pack directory: ${rel}`,
    );
  }
  if (!(await exists(abs))) {
    throw new PhdudeError(
      'VALIDATION',
      `venue profile ${name}: missing ${what} file ${rel}`,
      `add ${rel} to the pack, or point ${what} somewhere it exists`,
    );
  }
  if (escapes(relative(await realpath(dir), await realpath(abs)))) {
    throw new PhdudeError(
      'VALIDATION',
      `venue profile ${name}: ${what} path escapes the pack directory: ${rel}`,
    );
  }
  return abs;
}

async function readProfile(dir, name) {
  const profile = parse(await readFile(join(dir, 'profile.yaml'), 'utf8'));
  const result = validateProfile(profile);
  if (!result.ok) {
    throw new PhdudeError(
      'VALIDATION',
      `invalid venue profile ${name}`,
      `fix ${join('venues', name, 'profile.yaml')}`,
      result.errors,
    );
  }
  if (profile.name !== name) {
    throw new PhdudeError(
      'VALIDATION',
      `venue profile in venues/${name}/ calls itself ${profile.name}`,
      'a profile name is the directory it lives in',
    );
  }

  // `citation_style` is either a CSL file the pack ships or the name of a style the renderer
  // already knows; only the first can be resolved to a path, and only the first has to exist.
  const cslPath = profile.citation_style.endsWith('.csl')
    ? await resolveInPack(dir, name, profile.citation_style, 'citation_style')
    : null;

  const templatePaths = {};
  for (const [kind, rel] of Object.entries(profile.templates ?? {})) {
    templatePaths[kind] = await resolveInPack(dir, name, rel, `templates.${kind}`);
  }

  return { ...profile, dir, cslPath, templatePaths };
}

/**
 * A venue profile: what the venue expects of a manuscript (spec §3.2). It lives beside a venue
 * pack rather than inside `pack.yaml` because a profile is validation data, not a skill bundle.
 *
 * Absence is reported, not thrown: `gate-profile` runs on every submit and a manuscript naming a
 * venue this install does not ship must not stop the writing pipeline. The commands that need a
 * profile turn the null into a typed error (see application/profile.js).
 *
 * @param {string} name
 * @param {string[]} [roots] - searched in order; a later root overrides an earlier one
 * @returns {Promise<object|null>} the profile, its `dir` and its resolved `cslPath` and
 *   `templatePaths`, or null when the venue ships none
 */
export async function loadProfile(name, roots = [DEFAULT_PACKS_DIR]) {
  assertVenueName(name);

  let found = null;
  for (const root of roots) {
    const dir = join(root, 'venues', name);
    if (await exists(join(dir, 'profile.yaml'))) found = dir;
  }
  if (found === null) return null;
  return readProfile(found, name);
}

/**
 * Every venue that ships a profile across `roots`, a later root's profile overriding an earlier
 * one of the same name. A venue directory holding only a `pack.yaml` is not listed: there is
 * nothing to check a manuscript against.
 * @param {string[]} roots
 * @returns {Promise<object[]>} profiles sorted by name
 */
export async function discoverProfiles(roots) {
  const byName = new Map();
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(join(root, 'venues'), { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !VENUE_NAME_RE.test(entry.name)) continue;
      const dir = join(root, 'venues', entry.name);
      if (!(await exists(join(dir, 'profile.yaml')))) continue;
      byName.set(entry.name, await readProfile(dir, entry.name));
    }
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
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

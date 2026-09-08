import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PhdudeError } from '../../domain/errors.js';
import { parseFrontMatter } from '../agents/shared.js';

const SKILL_FILE = 'SKILL.md';

// `.git` is the clone's own bookkeeping, never part of the skill: copying it would put a whole
// repository under `.phdude/skills/<name>/` and make the recorded hash depend on when it was
// cloned.
const IGNORED = new Set(['.git']);

// A symlink is refused rather than skipped or followed. Following one would copy bytes from
// outside the directory the researcher named, and skipping it would install a skill missing a
// file it declares.
async function collect(dir, prefix, files) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (IGNORED.has(entry.name)) continue;
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new PhdudeError(
        'VALIDATION',
        `symlink inside the skill directory: ${rel}`,
        'a skill is installed as plain files; copy what the link points at',
      );
    }
    if (entry.isDirectory()) {
      await collect(join(dir, entry.name), rel, files);
      continue;
    }
    if (!entry.isFile()) continue;
    files.push({ path: rel, bytes: await readFile(join(dir, entry.name)) });
  }
  return files;
}

/**
 * Reads a skill directory into memory: every file under it, in path order, plus the purpose
 * strings its `SKILL.md` front matter declares. Nothing is validated here beyond the file
 * being there - the contract is the loader's job and the purpose is the domain's.
 * @param {string} dir
 * @returns {Promise<{files: {path: string, bytes: Buffer}[], name: string|null, description: string}>}
 */
export async function readSkillSource(dir) {
  let files;
  try {
    files = await collect(dir, '', []);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new PhdudeError(
        'USAGE',
        `no such directory: ${dir}`,
        'a skill is a directory holding SKILL.md',
      );
    }
    if (err.code === 'ENOTDIR') {
      throw new PhdudeError(
        'USAGE',
        `not a directory: ${dir}`,
        'a skill is a directory holding SKILL.md',
      );
    }
    throw err;
  }

  const skillMd = files.find((file) => file.path === SKILL_FILE);
  if (skillMd === undefined) {
    throw new PhdudeError(
      'VALIDATION',
      `no SKILL.md in ${dir}`,
      'a skill is a directory holding SKILL.md',
    );
  }
  const { meta } = parseFrontMatter(skillMd.bytes.toString('utf8'));
  return { files, name: meta?.name ?? null, description: meta?.description ?? '' };
}

/**
 * Writes a tree read by `readSkillSource` into `dir`. Used for the staging copy the contract is
 * validated against, outside the workspace; the workspace copy goes through the store.
 * @param {{path: string, bytes: Uint8Array}[]} files
 * @param {string} dir
 */
export async function writeSkillTree(files, dir) {
  for (const file of files) {
    const target = join(dir, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
  }
}

export function tempSkillDir() {
  return mkdtemp(join(tmpdir(), 'phdude-skill-'));
}

export function removeSkillDir(dir) {
  return rm(dir, { recursive: true, force: true });
}

/**
 * `git clone --depth 1 <url> <dir>` through `execFile` with an argument array - never a shell,
 * and never a URL the domain has not already limited to https without credentials. `execFile`
 * is injected so a test can drive an install from a git URL without a network.
 * @param {{execFile: Function}} deps
 * @returns {(url: string, dir: string) => Promise<void>}
 */
export function gitCloner({ execFile }) {
  return (url, dir) =>
    new Promise((resolve, reject) => {
      execFile('git', ['clone', '--depth', '1', url, dir], (err, stdout, stderr) => {
        if (err === null || err === undefined) {
          resolve();
          return;
        }
        if (err.code === 'ENOENT') {
          reject(
            new PhdudeError(
              'TOOL_MISSING',
              'git is not installed',
              'install git, or clone the skill yourself and install from the directory',
            ),
          );
          return;
        }
        const detail = String(stderr ?? err.message ?? '').trim();
        reject(
          new PhdudeError(
            'EXECUTION',
            `git clone failed: ${url}`,
            detail === '' ? 'check the URL' : detail.split('\n').at(-1),
          ),
        );
      });
    });
}

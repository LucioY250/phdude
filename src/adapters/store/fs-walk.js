import { readFile, readdir, lstat, realpath as fsRealpath, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SKIP_NAMES = new Set(['.git', 'node_modules', '.phdude']);

function shouldSkip(name) {
  return name.startsWith('.') || SKIP_NAMES.has(name);
}

/**
 * Recursively yields `{ path, mtime, bytes }` for every file under `entryPath`,
 * skipping `.git`, `node_modules`, `.phdude` and dotfiles. `entryPath` may itself
 * be a file, in which case it is yielded directly.
 *
 * A symlink is never followed, whether it is named directly or found during the walk:
 * following one would let a link inside the workspace read and cache a file outside it, which
 * is the containment `application/ingest.js` enforces lexically. Each is reported as
 * `{ symlink }` so the caller can warn rather than skip in silence.
 */
export async function* walk(entryPath) {
  const st = await lstat(entryPath);
  if (st.isSymbolicLink()) {
    yield { symlink: entryPath };
    return;
  }
  if (st.isFile()) {
    yield { path: entryPath, mtime: st.mtime.toISOString(), bytes: st.size };
    return;
  }
  const entries = await readdir(entryPath, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue;
    const full = join(entryPath, entry.name);
    if (entry.isSymbolicLink()) {
      yield { symlink: full };
    } else if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      const fst = await stat(full);
      yield { path: full, mtime: fst.mtime.toISOString(), bytes: fst.size };
    }
  }
}

export async function read(path) {
  return readFile(path);
}

/**
 * The fully resolved path, symlinks followed. `application/ingest.js` compares it against the
 * resolved workspace root, because lexical containment alone cannot see through a link.
 */
export async function realpath(path) {
  return fsRealpath(path);
}

import { isAbsolute, relative, resolve, sep } from 'node:path';
import { PhdudeError } from '../domain/errors.js';

/**
 * @param {string} requestedPath
 * @param {string} hint
 * @returns {PhdudeError}
 */
export function outsideWorkspace(requestedPath, hint) {
  return new PhdudeError('USAGE', `path is outside the workspace: ${requestedPath}`, hint);
}

/**
 * Lexical containment cannot see through a symlink: `sources/escape` may resolve anywhere. The
 * walker refuses to follow links, and this refuses to start behind one.
 * @param {{realpath: (path: string) => Promise<string>}} fs
 * @param {string} root - the workspace root
 * @param {string} requestedPath - as the researcher wrote it, for the message
 * @param {string} absPath - the lexically resolved path
 * @param {string} hint
 */
export async function assertRealPathInsideRoot(fs, root, requestedPath, absPath, hint) {
  let realRoot;
  let realPath;
  try {
    realRoot = await fs.realpath(root);
    realPath = await fs.realpath(absPath);
  } catch (err) {
    // A path that does not exist yet is the reader's error to report, with its own hint.
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
  // `..` and `../x` leave the root; `..hidden` is a legitimate directory name inside it.
  const back = relative(realRoot, realPath);
  const outside = back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back);
  if (outside) throw outsideWorkspace(requestedPath, hint);
}

/**
 * The same guard over every path a record declares at once, so a script, its results file and
 * whatever else it writes are all checked by one rule.
 * @param {{realpath: (path: string) => Promise<string>}} fs
 * @param {string} root - the workspace root
 * @param {string[]} paths - workspace-relative
 * @param {string} hint
 */
export async function assertPathsInsideRoot(fs, root, paths, hint) {
  for (const rel of paths) {
    await assertRealPathInsideRoot(fs, root, rel, resolve(root, rel), hint);
  }
}

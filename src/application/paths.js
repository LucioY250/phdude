import { isAbsolute, relative } from 'node:path';
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
  const back = relative(realRoot, realPath);
  if (back.startsWith('..') || isAbsolute(back)) throw outsideWorkspace(requestedPath, hint);
}

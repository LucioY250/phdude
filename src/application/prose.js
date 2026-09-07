import { PhdudeError } from '../domain/errors.js';
import { lint } from '../domain/prose-lint.js';

// The Academic Prose Quality report of PRD §39.1, over a plain text file. `phdude prose
// <section>` (v0.4 Task 4) will run the same lint over a manuscript section with its claims,
// evidence and voice profile attached; this text-only mode is what the `academic-prose` skill's
// `scripts/prose-lint.mjs` shells out to, and it needs no workspace at all.
//
// It reports; it never blocks. Exit stays 0 whatever the observations say.

const DEFAULT_LANG = 'en';

/**
 * @param {{fs: {read: (path: string) => Promise<Buffer>}}} deps
 * @param {string} path - the file to lint, already resolved against the caller's cwd
 * @param {{lang?: string}} [options]
 * @returns {Promise<object>} the lint report with the file it describes
 */
export async function proseFile({ fs }, path, { lang } = {}) {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new PhdudeError(
      'USAGE',
      'prose needs a file to read',
      'phdude prose --file <path> [--lang en|es]',
    );
  }

  let text;
  try {
    text = (await fs.read(path)).toString('utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new PhdudeError('USAGE', `not found: ${path}`, 'pass the path to a text file');
    }
    if (err.code === 'EISDIR') {
      throw new PhdudeError('USAGE', `not a file: ${path}`, 'pass one file, not a directory');
    }
    throw err;
  }

  return { file: path, ...lint(text, { lang: lang ?? DEFAULT_LANG }) };
}

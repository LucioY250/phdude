import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PhdudeError } from '../../domain/errors.js';

// Enough room for a chatty tool's log, and a ceiling so a runaway one cannot exhaust memory.
export const MAX_BUFFER = 10 * 1024 * 1024;

// How much of a failed tool's output travels with the error. The first lines of a LaTeX log are
// the banner; the last ones are what went wrong.
const LOG_TAIL_LINES = 20;

// The optional inputs a render may name, and what to call each one when it is not on disk.
const OPTIONAL_INPUTS = {
  bibPath: 'bibliography',
  cslPath: 'CSL style',
  referenceDoc: 'reference document',
  template: 'template',
};

/**
 * A promise around an injected `execFile`. It keeps node's callback shape rather than
 * `promisify`, so a test double is an ordinary function and never needs the promisify symbol.
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export function execFileAsync(execFile, file, args, options) {
  return new Promise((resolvePromise, reject) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      if (err) {
        err.stdout = err.stdout ?? stdout ?? '';
        err.stderr = err.stderr ?? stderr ?? '';
        reject(err);
        return;
      }
      resolvePromise({ stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

export function assertFormat(renderer, format) {
  if (renderer.formats.includes(format)) return;
  throw new PhdudeError(
    'VALIDATION',
    `${renderer.name} does not render ${format}`,
    `formats: ${renderer.formats.join(', ')}`,
  );
}

async function readablePath(cwd, path, label) {
  const absolute = resolve(cwd, path);
  try {
    if ((await stat(absolute)).isFile()) return absolute;
  } catch {
    // Reported below as the same failure: the render was told to read something that is not
    // there, which is a malformed request whether or not the rendering tool is installed.
  }
  throw new PhdudeError(
    'VALIDATION',
    `${label} not found: ${absolute}`,
    'render from files the workspace has written; build assembles them under outputs/',
  );
}

/**
 * Resolves every path a render was given against `cwd` and refuses the ones that are not on
 * disk. Validation comes before the availability probe on purpose: a missing tool is not what is
 * wrong with a request that names a file nobody wrote.
 * @returns {Promise<{markdownPath: string, bibPath: string|null, cslPath: string|null,
 *   referenceDoc: string|null, template: string|null}>}
 */
export async function resolveInputs(cwd, input = {}) {
  if (!input.markdownPath) {
    throw new PhdudeError(
      'VALIDATION',
      'no markdown input given',
      'render takes input.markdownPath, the assembled manuscript',
    );
  }

  const resolved = { markdownPath: await readablePath(cwd, input.markdownPath, 'markdown input') };
  for (const [key, label] of Object.entries(OPTIONAL_INPUTS)) {
    resolved[key] = input[key] ? await readablePath(cwd, input[key], label) : null;
  }
  return resolved;
}

/**
 * The absolute path a render writes to, with its parent directory created. A build writes into
 * `outputs/<slug>/`, and a renderer that made every caller mkdir first would push that on all of
 * them.
 * @returns {Promise<string>}
 */
export async function prepareOutput(cwd, path) {
  const absolute = resolve(cwd, path);
  await mkdir(dirname(absolute), { recursive: true });
  return absolute;
}

export function toolMissing(what, hint) {
  return new PhdudeError('TOOL_MISSING', `${what} is not available`, hint);
}

export function logTail(...chunks) {
  return chunks
    .join('\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-LOG_TAIL_LINES);
}

export async function exists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

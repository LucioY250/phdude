import { PhdudeError } from '../../domain/errors.js';
import { latexRenderer } from './latex.js';
import { markdownRenderer } from './markdown.js';
import { pandocRenderer } from './pandoc.js';

/**
 * The shipped renderers, in precedence order: the built-in Markdown one first, so `md` never
 * depends on a tool being installed even where pandoc is; pandoc for the formats it owns; the
 * LaTeX adapter last, for the one format that needs pandoc *and* a TeX engine.
 * @param {{execFile: Function, env?: object, version?: string, paths?: object}} deps
 * @returns {import('../../ports/document-renderer.js').DocumentRenderer[]}
 */
export function buildRenderers({ execFile, env = {}, version, paths = {} } = {}) {
  const pandoc = pandocRenderer({ execFile, env, path: paths.pandoc });
  return [markdownRenderer({ version }), pandoc, latexRenderer({ execFile, env, paths, pandoc })];
}

/**
 * The renderer a format goes to. First match wins, which is what makes the order above the
 * documented precedence rather than an accident of the array.
 * @param {import('../../ports/document-renderer.js').DocumentRenderer[]} renderers
 * @param {string} format
 * @returns {import('../../ports/document-renderer.js').DocumentRenderer}
 */
export function rendererFor(renderers, format) {
  const found = renderers.find((renderer) => renderer.formats.includes(format));
  if (found) return found;

  const known = [...new Set(renderers.flatMap((renderer) => renderer.formats))].sort();
  throw new PhdudeError(
    'VALIDATION',
    `no renderer for format: ${format}`,
    `formats: ${known.join(', ')}`,
  );
}

import { basename } from 'node:path';
import { PhdudeError } from '../../domain/errors.js';
import {
  assertFormat,
  execFileAsync,
  exists,
  logTail,
  MAX_BUFFER,
  prepareOutput,
  resolveInputs,
  toolMissing,
} from './shared.js';

// What PhDude calls each format, and what pandoc calls it.
const PANDOC_FORMAT = {
  docx: 'docx',
  html: 'html',
  latex: 'latex',
  md: 'markdown',
  pptx: 'pptx',
};

// A `.tex` a build hands to LaTeX, and an `.html` a researcher opens, both have to be whole
// documents; the binary formats are whole by construction.
const STANDALONE = new Set(['latex', 'html']);
const REFERENCE_DOC = new Set(['docx', 'pptx']);
const TEMPLATE = new Set(['latex', 'html', 'md']);

const INSTALL_HINT =
  'install pandoc (apt install pandoc / brew install pandoc) to build docx, pptx, html and latex, or set PHDUDE_PANDOC to its path';

function metadataArgs(metadata = {}) {
  const args = [];
  for (const key of Object.keys(metadata).sort()) {
    const value = metadata[key];
    for (const item of Array.isArray(value) ? value : [value]) {
      args.push('--metadata', `${key}=${item}`);
    }
  }
  return args;
}

/**
 * Pandoc, called with an argument array and never a shell. Every optional input is an argument
 * only where the format can use it; where it cannot, the file is named in `warnings` instead of
 * being passed to a pandoc that would reject it.
 * @param {{execFile: Function, env?: object, path?: string}} deps
 * @returns {import('../../ports/document-renderer.js').DocumentRenderer}
 */
export function pandocRenderer({ execFile, env = {}, path } = {}) {
  const pandoc = path ?? env.PHDUDE_PANDOC ?? 'pandoc';
  let probe = null;

  const renderer = {
    name: 'pandoc',
    formats: Object.keys(PANDOC_FORMAT).sort(),

    async available() {
      probe ??= (async () => {
        try {
          const { stdout } = await execFileAsync(execFile, pandoc, ['--version'], {
            maxBuffer: MAX_BUFFER,
          });
          const version = /pandoc[^\d]*([\d][\d.]*)/i.exec(stdout);
          return { ok: true, version: version ? version[1] : 'unknown' };
        } catch (err) {
          // Only "there is no such executable" means pandoc is missing. A pandoc that dislikes
          // `--version` is installed, and a render is what will say what is wrong with it.
          if (err.code === 'ENOENT') return { ok: false, hint: INSTALL_HINT };
          return { ok: true, version: 'unknown' };
        }
      })();
      return probe;
    },

    async render({ input, output, cwd }) {
      assertFormat(renderer, output.format);
      const paths = await resolveInputs(cwd, input);
      const target = await prepareOutput(cwd, output.path);

      const availability = await renderer.available();
      if (!availability.ok) throw toolMissing('pandoc', availability.hint);

      const format = output.format;
      const warnings = [];
      const args = ['--from', 'markdown', '--to', PANDOC_FORMAT[format], '--output', target];
      if (STANDALONE.has(format)) args.push('--standalone');
      if (paths.bibPath) args.push('--citeproc', '--bibliography', paths.bibPath);
      if (paths.cslPath) args.push('--csl', paths.cslPath);

      if (paths.referenceDoc) {
        if (REFERENCE_DOC.has(format)) args.push('--reference-doc', paths.referenceDoc);
        else
          warnings.push(
            `a reference document applies to docx and pptx only; ${basename(paths.referenceDoc)} was not applied to ${format}`,
          );
      }
      if (paths.template) {
        if (TEMPLATE.has(format)) args.push('--template', paths.template);
        else
          warnings.push(
            `a template applies to ${[...TEMPLATE].join(', ')} only; ${basename(paths.template)} was not applied to ${format}`,
          );
      }

      args.push(...metadataArgs(input.metadata), paths.markdownPath);

      try {
        await execFileAsync(execFile, pandoc, args, { cwd, maxBuffer: MAX_BUFFER });
      } catch (err) {
        throw new PhdudeError(
          'EXECUTION',
          `pandoc failed: ${err.message}`,
          'run the same conversion by hand to see the whole message; the assembled Markdown is under outputs/',
          logTail(err.stdout, err.stderr),
        );
      }

      // Hashing whatever happens to be at the path would record a render that did not happen.
      if (!(await exists(target))) {
        throw new PhdudeError(
          'EXECUTION',
          `pandoc exited 0 but wrote no file: ${target}`,
          'check that the output path is writable',
        );
      }

      return { path: target, warnings };
    },
  };

  return renderer;
}

import { PhdudeError } from '../../domain/errors.js';
import { execFileAsync, exists, logTail, MAX_BUFFER } from './shared.js';

const INSTALL_HINT =
  'install rsvg-convert (apt install librsvg2-bin / brew install librsvg) to convert SVG figures, or set PHDUDE_RSVG_CONVERT to its path';

/**
 * SVG to PDF, for the venues that take PDF figures and not SVG ones. It is not a
 * `DocumentRenderer`: it converts one image, has no Markdown input and no metadata, so it stands
 * on its own rather than pretending to that port. A build without it copies the SVG across and
 * says so.
 * @param {{execFile: Function, env?: object, path?: string}} deps
 */
export function svgConverter({ execFile, env = {}, path } = {}) {
  const bin = path ?? env.PHDUDE_RSVG_CONVERT ?? 'rsvg-convert';
  let probe = null;

  return {
    name: 'rsvg-convert',
    hint: INSTALL_HINT,

    async available() {
      probe ??= (async () => {
        try {
          const { stdout } = await execFileAsync(execFile, bin, ['--version'], {
            maxBuffer: MAX_BUFFER,
          });
          const version = /([\d][\d.]*)/.exec(stdout);
          return { ok: true, version: version ? version[1] : 'unknown' };
        } catch (err) {
          if (err.code === 'ENOENT') return { ok: false, hint: INSTALL_HINT };
          return { ok: true, version: 'unknown' };
        }
      })();
      return probe;
    },

    /**
     * @param {{from: string, to: string, format?: string}} input - absolute paths
     * @returns {Promise<{path: string}>}
     */
    async convert({ from, to, format = 'pdf' }) {
      const args = ['--format', format, '--output', to, from];
      try {
        await execFileAsync(execFile, bin, args, { maxBuffer: MAX_BUFFER });
      } catch (err) {
        throw new PhdudeError(
          'EXECUTION',
          `rsvg-convert failed: ${err.message}`,
          'convert the figure by hand, or declare a PDF output on the figure',
          logTail(err.stdout, err.stderr),
        );
      }
      // The same rule the renderers follow: the artifact decides, not the exit code.
      if (!(await exists(to))) {
        throw new PhdudeError(
          'EXECUTION',
          `rsvg-convert exited 0 but wrote no file: ${to}`,
          'check that the output path is writable',
        );
      }
      return { path: to };
    },
  };
}

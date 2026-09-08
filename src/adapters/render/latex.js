import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const JOB = 'manuscript';

const TEX_HINT =
  'install a TeX distribution (apt install texlive-latex-base latexmk, or MacTeX on macOS) to build PDF';

/**
 * PDF, which no single tool produces: pandoc writes the LaTeX and a TeX engine compiles it, so
 * this renderer is available only when both are. `latexmk` is preferred because it decides how
 * many passes the document needs; `pdflatex` is the fallback and does the passes by hand.
 * @param {{execFile: Function, env?: object, paths?: object,
 *   pandoc: import('../../ports/document-renderer.js').DocumentRenderer}} deps
 * @returns {import('../../ports/document-renderer.js').DocumentRenderer}
 */
export function latexRenderer({ execFile, env = {}, paths = {}, pandoc } = {}) {
  const latexmk = paths.latexmk ?? env.PHDUDE_LATEXMK ?? 'latexmk';
  const pdflatex = paths.pdflatex ?? env.PHDUDE_PDFLATEX ?? 'pdflatex';
  const bibtex = paths.bibtex ?? env.PHDUDE_BIBTEX ?? 'bibtex';
  let probe = null;
  let engine = null;

  async function engineVersion(file, args) {
    try {
      const { stdout } = await execFileAsync(execFile, file, args, { maxBuffer: MAX_BUFFER });
      const version = /version\s+([\d][\d.]*)/i.exec(stdout) ?? /([\d][\d.]*)/.exec(stdout);
      return version ? version[1] : 'unknown';
    } catch {
      return null;
    }
  }

  const renderer = {
    name: 'latex',
    formats: ['pdf'],

    async available() {
      probe ??= (async () => {
        const upstream = await pandoc.available();
        if (!upstream.ok) return { ok: false, hint: upstream.hint };

        for (const [candidate, file, args] of [
          ['latexmk', latexmk, ['-v']],
          ['pdflatex', pdflatex, ['--version']],
        ]) {
          const version = await engineVersion(file, args);
          if (version === null) continue;
          engine = candidate;
          return { ok: true, version: `${candidate} ${version} with pandoc ${upstream.version}` };
        }
        return { ok: false, hint: TEX_HINT };
      })();
      return probe;
    },

    async render({ input, output, cwd }) {
      assertFormat(renderer, output.format);
      await resolveInputs(cwd, input);
      const target = await prepareOutput(cwd, output.path);

      const availability = await renderer.available();
      if (!availability.ok) throw toolMissing('pdf rendering', availability.hint);

      const dir = await mkdtemp(join(tmpdir(), 'phdude-latex-'));
      try {
        const tex = join(dir, `${JOB}.tex`);
        const { warnings } = await pandoc.render({
          input,
          output: { path: tex, format: 'latex' },
          cwd,
        });

        const log = await compile(dir);
        const pdf = join(dir, `${JOB}.pdf`);
        // The artifact decides, not the exit code: LaTeX routinely exits non-zero over a warning
        // and still writes a PDF, and routinely exits zero having written nothing.
        if (!(await exists(pdf))) {
          throw new PhdudeError(
            'EXECUTION',
            `${engine} produced no PDF from the rendered LaTeX`,
            'build --format latex first and compile it by hand to see the whole log',
            log,
          );
        }

        await copyFile(pdf, target);
        return { path: target, warnings };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };

  async function run(collected, file, args, cwd) {
    try {
      const { stdout, stderr } = await execFileAsync(execFile, file, args, {
        cwd,
        maxBuffer: MAX_BUFFER,
      });
      collected.push(stdout, stderr);
    } catch (err) {
      if (err.code === 'ENOENT') throw toolMissing(file, TEX_HINT);
      collected.push(err.stdout ?? '', err.stderr ?? '', err.message);
    }
  }

  // A `\bibdata` line in the aux file is LaTeX saying it wants BibTeX; with citeproc the
  // bibliography is already in the .tex and there is nothing for BibTeX to do.
  async function wantsBibtex(dir) {
    try {
      return (await readFile(join(dir, `${JOB}.aux`), 'utf8')).includes('\\bibdata');
    } catch {
      return false;
    }
  }

  async function compile(dir) {
    const collected = [];
    if (engine === 'latexmk') {
      await run(collected, latexmk, ['-pdf', '-interaction=nonstopmode', `${JOB}.tex`], dir);
      return logTail(...collected);
    }

    const pass = () => run(collected, pdflatex, ['-interaction=nonstopmode', `${JOB}.tex`], dir);
    await pass();
    if (await wantsBibtex(dir)) {
      await run(collected, bibtex, [JOB], dir);
      await pass();
    }
    await pass();
    return logTail(...collected);
  }

  return renderer;
}

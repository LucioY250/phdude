import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { stringify } from 'yaml';
import { parseBibtex } from '../../domain/bibtex.js';
import { resolveCitations } from '../../domain/citations-md.js';
import { citationsIn } from '../../domain/gates/citations.js';
import { assertFormat, prepareOutput, resolveInputs } from './shared.js';

// Pandoc's own metadata keys, first and in this order, so a rendered file opens the way a
// manuscript does; everything else the caller passes follows in a stable order of its own.
const METADATA_ORDER = ['title', 'author', 'date'];

// What the built-in renderer cannot honour. Each one is a warning naming the file, never a
// silent drop: a researcher who passed a venue's CSL has to learn it was not applied.
const UNSUPPORTED = {
  cslPath: 'CSL support; %s was not applied, references are plain author-year',
  referenceDoc: 'reference-document support; %s was not applied',
  template: 'template support; %s was not applied',
};

function frontMatter(metadata = {}) {
  const keys = Object.keys(metadata);
  if (keys.length === 0) return '';

  const ordered = {};
  for (const key of METADATA_ORDER) if (key in metadata) ordered[key] = metadata[key];
  for (const key of keys.filter((k) => !METADATA_ORDER.includes(k)).sort()) {
    ordered[key] = metadata[key];
  }
  return `---\n${stringify(ordered)}---\n\n`;
}

/**
 * The renderer that always works. It needs nothing installed, which is what makes
 * `phdude build --format md` a promise rather than a hope: Markdown in, Markdown out, with
 * `[@key]` resolved to plain author-year and the cited entries listed under `## References`.
 * @param {{version?: string}} deps
 * @returns {import('../../ports/document-renderer.js').DocumentRenderer}
 */
export function markdownRenderer({ version } = {}) {
  const renderer = {
    name: 'markdown',
    formats: ['md'],

    async available() {
      return { ok: true, version: `phdude ${version ?? 'unknown'}` };
    },

    async render({ input, output, cwd }) {
      assertFormat(renderer, output.format);
      const paths = await resolveInputs(cwd, input);
      const target = await prepareOutput(cwd, output.path);

      const warnings = [];
      for (const [key, note] of Object.entries(UNSUPPORTED)) {
        if (paths[key]) {
          warnings.push(
            `the built-in markdown renderer has no ${note.replace('%s', basename(paths[key]))}`,
          );
        }
      }

      const source = await readFile(paths.markdownPath, 'utf8');
      let body = source;
      if (paths.bibPath) {
        const resolved = resolveCitations(
          source,
          parseBibtex(await readFile(paths.bibPath, 'utf8')),
        );
        body = resolved.markdown;
        warnings.push(...resolved.warnings);
      } else if (citationsIn(source).length > 0) {
        warnings.push('no bibliography was given; citations were left as written');
      }

      await writeFile(target, `${frontMatter(input.metadata)}${body}`);
      return { path: target, warnings };
    },
  };

  return renderer;
}

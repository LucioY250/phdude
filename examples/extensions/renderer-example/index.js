// SPDX-License-Identifier: MIT
//
// An example third-party PhDude DocumentRenderer. It renders the assembled manuscript to plain
// text by stripping Markdown, needs no external tool, and is therefore always available.
// Nothing here imports PhDude.
//
// See docs/extension-api.md#documentrenderer for the contract this satisfies.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const NAME = 'example-plain-text';
const VERSION = '1.0.0';
const FORMATS = ['txt'];

// What this renderer cannot honour. Each one becomes a warning naming the file, never a silent
// drop: a researcher who passed a venue's CSL style has to learn it was not applied.
const UNSUPPORTED = {
  bibPath: 'bibliography',
  cslPath: 'CSL style',
  referenceDoc: 'reference document',
  template: 'template',
};

export const exampleRenderer = {
  name: NAME,
  formats: FORMATS,

  async available() {
    return { ok: true, version: `${NAME} ${VERSION}` };
  },

  /**
   * Validation comes first and does not depend on the tool: a format this renderer does not
   * declare, or an input file nobody wrote, is a malformed request on every machine. A renderer
   * with an external tool would probe it next and refuse with TOOL_MISSING; this one has none.
   * @param {{input: object, output: {path: string, format: string}, cwd: string}} opts
   * @returns {Promise<{path: string, warnings: string[]}>}
   */
  async render({ input, output, cwd }) {
    if (!FORMATS.includes(output.format)) {
      throw phdudeError(
        'VALIDATION',
        `${NAME} does not render ${output.format}`,
        `formats: ${FORMATS.join(', ')}`,
      );
    }

    const markdownPath = await readableFile(cwd, input?.markdownPath, 'markdown input');
    const warnings = [];
    for (const [key, label] of Object.entries(UNSUPPORTED)) {
      if (input?.[key]) {
        warnings.push(`${NAME} has no ${label} support; ${input[key]} was not applied`);
      }
    }

    const source = await readFile(markdownPath, 'utf8');
    // The output's parent may not exist yet: a build writes into outputs/<slug>/, and a renderer
    // that made every caller mkdir first would push that on all of them.
    const target = resolve(cwd, output.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, toPlainText(source, input?.metadata ?? {}), 'utf8');

    return { path: target, warnings };
  },
};

async function readableFile(cwd, path, label) {
  if (!path) {
    throw phdudeError(
      'VALIDATION',
      `no ${label} given`,
      'render takes input.markdownPath, the assembled manuscript',
    );
  }
  const absolute = resolve(cwd, path);
  try {
    if ((await stat(absolute)).isFile()) return absolute;
  } catch {
    // Reported below as the same failure: the render was told to read something nobody wrote.
  }
  throw phdudeError(
    'VALIDATION',
    `${label} not found: ${absolute}`,
    'render from files the workspace has written; build assembles them under outputs/',
  );
}

// Deterministic by construction: no clock, no random ids, nothing fetched. The same manuscript
// and the same metadata always produce the same bytes, which is what lets a build cache treat
// "the inputs did not change" as "the output would not change".
function toPlainText(markdown, metadata) {
  const header = [];
  for (const key of ['title', 'author', 'date']) {
    if (metadata[key] !== undefined) header.push(`${key}: ${[metadata[key]].flat().join(', ')}`);
  }

  const body = markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return `${header.length ? `${header.join('\n')}\n\n` : ''}${body}\n`;
}

// PhDude recognises its typed errors structurally - `name`, `code`, `hint` - so an extension
// living outside the package raises the same shape rather than importing the class.
function phdudeError(code, message, hint = null, details = null) {
  const err = new Error(message);
  err.name = 'PhdudeError';
  err.code = code;
  err.hint = hint;
  err.details = details;
  return err;
}

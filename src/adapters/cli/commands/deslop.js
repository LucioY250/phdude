import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as deslopApp from '../../../application/deslop.js';
import { PhdudeError } from '../../../domain/errors.js';
import { renderDeslop } from '../output.js';

function renderRevision(result) {
  const lines = [`Revised ${result.section.id} (${result.section.status})`, `  ${result.path}`];
  for (const finding of result.findings) {
    lines.push(`  ${finding.severity} ${finding.gate}:${finding.line} ${finding.message}`);
  }
  lines.push(`  gates: ${result.report.gates.map((g) => g.gate).join(', ')}`);
  return lines.join('\n') + '\n';
}

export default async function deslopCommand({ positionals, flags, deps, cwd }) {
  const section = positionals[1];
  if (!section) {
    throw new PhdudeError(
      'USAGE',
      'deslop needs a section',
      'phdude deslop <section> [--file <revised.md>] [--allow-additions]',
    );
  }

  const result = await deslopApp.deslop(
    {
      ...deps,
      // The revision is a file the agent just wrote next to its own working directory, not a
      // workspace object, so it is read relative to the shell's cwd rather than the store.
      readText: async (path) => {
        try {
          return await readFile(resolve(cwd, path), 'utf8');
        } catch (err) {
          if (err.code === 'ENOENT' || err.code === 'EISDIR') return null;
          throw err;
        }
      },
    },
    { section, file: flags.file, allowAdditions: flags.allowAdditions },
  );

  return {
    text: result.revised ? renderRevision(result) : renderDeslop(result),
    json: result,
  };
}

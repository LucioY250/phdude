import { resolve } from 'node:path';
import * as proseApp from '../../../application/prose.js';
import { PhdudeError } from '../../../domain/errors.js';
import { renderProse } from '../output.js';

export default async function proseCommand({ flags, deps, cwd }) {
  if (!flags.file) {
    throw new PhdudeError(
      'USAGE',
      'prose needs --file <path>',
      'phdude prose --file <path> [--lang en|es]; the manuscript section form arrives with the manuscript commands',
    );
  }
  const result = await proseApp.proseFile({ fs: deps.fs }, resolve(cwd, flags.file), {
    lang: flags.lang,
  });
  return { text: renderProse(result), json: result };
}

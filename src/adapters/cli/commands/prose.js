import { resolve } from 'node:path';
import * as proseApp from '../../../application/prose.js';
import { PhdudeError } from '../../../domain/errors.js';
import { renderProse } from '../output.js';

export default async function proseCommand({ positionals, flags, deps, cwd }) {
  const section = positionals[1];

  if (flags.file) {
    const result = await proseApp.proseFile({ fs: deps.fs }, resolve(cwd, flags.file), {
      lang: flags.lang,
    });
    return { text: renderProse(result), json: result };
  }

  if (!section) {
    throw new PhdudeError(
      'USAGE',
      'prose needs a section or --file <path>',
      'phdude prose <section>, or phdude prose --file <path> [--lang en|es]',
    );
  }

  const result = await proseApp.proseSection(deps, section);
  return {
    text: `${result.section.id} (${result.section.status})  ${result.section.title}\n\n${renderProse(result)}`,
    json: result,
  };
}

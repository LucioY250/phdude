import * as writeApp from '../../../application/write.js';
import { renderWriteContext } from '../output.js';
import { PhdudeError } from '../../../domain/errors.js';

export default async function writeCommand({ positionals, flags, deps }) {
  const section = positionals[1];
  if (!section) {
    throw new PhdudeError(
      'USAGE',
      'write needs a section',
      'phdude write <section> [--voice <id>] [--budget <chars>]',
    );
  }
  const result = await writeApp.write(deps, {
    section,
    voice: flags.voice,
    budget: flags.budget,
  });
  return { text: renderWriteContext(result), json: result };
}

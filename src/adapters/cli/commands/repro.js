import * as repro from '../../../application/repro.js';
import { PhdudeError } from '../../../domain/errors.js';
import { renderRepro } from '../output.js';

export default async function reproCommand({ sub, deps }) {
  if (sub !== null && sub !== 'check') {
    throw new PhdudeError(
      'USAGE',
      `unknown repro subcommand: ${sub}`,
      'phdude repro check [--json]',
    );
  }
  const report = await repro.check({ store: deps.store, clock: deps.clock });
  return { text: renderRepro(report), json: report };
}

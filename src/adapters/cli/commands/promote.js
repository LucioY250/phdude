import { promote } from '../../../application/decide.js';
import { PhdudeError } from '../../../domain/errors.js';

export default async function promoteCommand({ positionals, flags, deps }) {
  const id = positionals[1] ?? flags.id;
  if (!id) {
    throw new PhdudeError(
      'USAGE',
      'promote needs an object id',
      'phdude promote <id> --decision <DEC-id>',
    );
  }

  const obj = await promote({ store: deps.store, clock: deps.clock, actor: deps.actor }, id, {
    to: flags.to,
    decision: flags.decision,
  });

  return { text: `${obj.id} is now ${obj.state}\n`, json: obj };
}

import { link } from '../../../application/link.js';
import { PhdudeError } from '../../../domain/errors.js';

export default async function linkCommand({ positionals, flags, deps }) {
  const id = positionals[1] ?? flags.id;
  if (!id) {
    throw new PhdudeError('USAGE', 'link needs an object id', 'phdude link <id> --to <id> [<id>…]');
  }

  const { obj, added } = await link(
    { store: deps.store, clock: deps.clock, actor: deps.actor },
    id,
    { to: flags.to },
  );

  const text = added.length
    ? `Linked ${obj.id} to ${added.join(', ')}\n`
    : `${obj.id} already links to every target\n`;
  return { text, json: obj };
}

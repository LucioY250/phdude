import * as present from '../../../application/present.js';
import { PhdudeError } from '../../../domain/errors.js';

function renderOutline(result) {
  const lines = result.written
    ? [`Wrote ${result.slides} slide(s):`, ...result.outputs.map((o) => `  ${o.path}`)]
    : [
        `The outline is up to date (${result.outputs.map((o) => o.path).join(', ')}).`,
        'Write it anyway with --force.',
      ];
  for (const warning of result.warnings) lines.push(`  - ${warning}`);
  return lines.join('\n') + '\n';
}

export default async function presentCommand({ sub, flags, deps }) {
  if (sub === 'outline') {
    const result = await present.outline(
      {
        store: deps.store,
        clock: deps.clock,
        actor: deps.actor,
        renderers: deps.renderers,
      },
      { from: flags.from, profile: flags.profile ?? null, force: flags.force },
    );
    return { text: renderOutline(result), json: result };
  }

  throw new PhdudeError(
    'USAGE',
    sub === null ? 'present needs a subcommand' : `unknown present subcommand: ${sub}`,
    'phdude present outline [--from manuscript|claims] [--profile <venue>]',
  );
}

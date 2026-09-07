import { PhdudeError } from '../../../domain/errors.js';
import { status } from '../../../application/status.js';
import { next } from '../../../application/next.js';
import { renderStatus, renderNext } from '../output.js';
import { runIngest, renderIngest } from './ingest.js';
import { runDetect } from './packs.js';

const HANDOFF =
  "Next: follow skill .phdude/skills/bootstrap/SKILL.md — classify artifacts with role 'unknown' " +
  "and extract sources, facts, and claims via 'phdude add'.";

export default async function bootstrapCommand(ctx) {
  // Checked first: without it the missing sources/ directory surfaces as "no such path",
  // whose hint tells the researcher to run the ingest bootstrap has already run.
  if (!(await ctx.deps.store.exists('phdude.yaml'))) {
    throw new PhdudeError('USAGE', 'not a PhDude workspace', 'run phdude init');
  }

  const ingested = await runIngest(ctx);
  const packs = await runDetect(ctx);
  const report = await status({ store: ctx.deps.store });
  const recommendation = await next({ store: ctx.deps.store });

  const packsLine = packs.recommended.length
    ? `Recommended packs: ${packs.recommended.join(', ')} (apply with \`phdude packs apply <name>\`)`
    : 'Recommended packs: (none)';

  const text = [
    renderIngest(ingested),
    packsLine,
    '',
    renderStatus(report),
    renderNext(recommendation),
    'Agent handoff:',
    HANDOFF,
    '',
  ].join('\n');

  return {
    text,
    json: {
      ingest: ingested,
      packs,
      status: report,
      next: recommendation,
      handoff: HANDOFF,
    },
  };
}

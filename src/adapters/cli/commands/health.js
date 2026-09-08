import { compute } from '../../../application/health.js';
import { renderHealth } from '../output.js';

export default async function healthCommand({ deps, flags }) {
  const report = await compute(
    { store: deps.store, clock: deps.clock, actor: deps.actor },
    { save: flags.save, trend: flags.trend },
  );
  return { text: renderHealth(report), json: report };
}

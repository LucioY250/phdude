import { freshness } from '../../../application/freshness.js';
import { renderFreshness } from '../output.js';

export default async function freshnessCommand({ deps }) {
  const report = await freshness({ store: deps.store, clock: deps.clock });
  return { text: renderFreshness(report), json: report };
}

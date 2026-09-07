import { status } from '../../../application/status.js';
import { renderStatus } from '../output.js';

export default async function statusCommand({ deps }) {
  const report = await status({ store: deps.store, clock: deps.clock });
  return { text: renderStatus(report), json: report };
}

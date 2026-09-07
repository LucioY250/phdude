import * as gapsApp from '../../../application/gaps.js';
import { renderGaps } from '../output.js';

export default async function gapsCommand({ deps }) {
  const result = await gapsApp.gaps({ store: deps.store, clock: deps.clock });
  return { text: renderGaps(result), json: result };
}

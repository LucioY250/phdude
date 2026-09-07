import { next } from '../../../application/next.js';
import { renderNext } from '../output.js';

export default async function nextCommand({ deps }) {
  const result = await next({ store: deps.store, clock: deps.clock });
  return { text: renderNext(result), json: result };
}

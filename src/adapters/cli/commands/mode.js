import { setMode, REVIEW_MODES } from '../../../application/mode.js';
import { PhdudeError } from '../../../domain/errors.js';

export default async function modeCommand({ positionals, deps }) {
  const mode = positionals[1];
  if (!mode) {
    throw new PhdudeError('USAGE', 'mode needs a value', `phdude mode <${REVIEW_MODES.join('|')}>`);
  }

  const result = await setMode({ store: deps.store, clock: deps.clock, actor: deps.actor }, mode);
  const text = result.changed ? `Mode set to ${mode}\n` : `Mode is already ${mode}\n`;
  return { text, json: result };
}

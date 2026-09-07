import { PhdudeError } from '../domain/errors.js';

export const REVIEW_MODES = ['lite', 'full', 'ruthless', 'off'];

/**
 * Sets the workspace review mode (PRD S40). Idempotent: setting the mode it already has
 * rewrites nothing and records no event.
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {string} mode
 * @returns {Promise<{mode: string, changed: boolean}>}
 */
export async function setMode({ store, clock, actor }, mode) {
  if (!REVIEW_MODES.includes(mode)) {
    throw new PhdudeError(
      'USAGE',
      `unknown mode: ${mode}`,
      `valid modes: ${REVIEW_MODES.join(', ')}`,
    );
  }

  const project = await store.readProject();
  if (project === null) {
    throw new PhdudeError('USAGE', 'phdude.yaml is missing', 'run phdude init first');
  }
  if (project.mode === mode) return { mode, changed: false };

  await store.writeProject({ ...project, mode });
  await store.appendEvent({
    ts: clock(),
    op: 'mode',
    actor,
    ids: [],
    summary: `mode set to ${mode}`,
  });
  return { mode, changed: true };
}

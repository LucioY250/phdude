import { join } from 'node:path';
import { ready } from '../domain/ready.js';
import * as cite from './cite.js';
import { REVIEW_MODES } from './mode.js';
import { requireProfile } from './profile.js';
import { loadSnapshot } from './snapshot.js';

const POLICY_PATH = join('.phdude', 'research-policy.yaml');

// The venue the verdict is about: what `--profile` names, or the one the manuscript already
// targets. Neither is not an error the way it is for `phdude profile check` - `ready` is about
// the whole workspace, and a workspace that has not chosen a venue can still be told what else
// is in the way. `domain/ready.js` warns that the venue rules went unchecked.
function venueOf(manuscript, requested) {
  if (typeof requested === 'string' && requested.trim() !== '') return requested.trim();
  const target = manuscript?.target_profile;
  return typeof target === 'string' && target.trim() !== '' ? target.trim() : null;
}

/**
 * The submission-readiness verdict (spec §3.4). It never writes and records no event: it reads
 * the workspace, the venue profile and the policy, and says whether the work can go out.
 *
 * The `cite check` findings come from the citation registry rather than being re-derived, and
 * the recorded `citation` reviews from the last `phdude audit citations` - the auditor is never
 * run from here, because running it would write.
 *
 * @param {{store: object, clock?: () => string,
 *   loadProfile: (name: string) => Promise<object|null>}} deps
 * @param {{profile?: string}} [input]
 * @returns {Promise<object>} the verdict, plus `at`
 */
export async function check({ store, clock, loadProfile }, { profile: requested } = {}) {
  const snapshot = await loadSnapshot(store, clock);
  const policy = await store.readYaml(POLICY_PATH);
  const citations = await cite.check({ store, snapshot });

  const venue = venueOf(snapshot.manuscript, requested);
  const profile = venue === null ? null : await requireProfile({ loadProfile }, venue);
  const mode = REVIEW_MODES.includes(snapshot.project?.mode) ? snapshot.project.mode : 'full';

  const verdict = ready({ ...snapshot, citations: citations.findings }, policy, { profile, mode });
  return { ...verdict, at: snapshot.now };
}

import { adaptedManuscript, planAdaptation } from '../domain/adapt.js';
import { DEFAULT_PROFILE } from '../domain/build.js';
import { PhdudeError } from '../domain/errors.js';
import { parseSectionFile } from '../domain/manuscript.js';
import { stableStringify } from '../domain/normalize.js';
import { assertValid } from '../schemas/index.js';
import { assertUpToDate } from './guard.js';
import { loadManuscript } from './manuscript.js';
import { requireProfile } from './profile.js';

/**
 * @param {string} venue
 * @returns {string} where the adapted manuscript lives, beside the canonical one
 */
export function adaptedPath(venue) {
  return `manuscript/manuscript.${venue}.yaml`;
}

/**
 * What moving this manuscript to another venue would take, and - with `apply` - the manuscript
 * that move would produce (spec §3.5).
 *
 * A plan reads and reports. `apply` writes one file, `manuscript/manuscript.<venue>.yaml`, whose
 * sections point at the same prose files as the canonical manuscript: nothing under `manuscript/`
 * is rewritten, and the sections the target venue no longer has room for are marked `revised` so
 * the writing pipeline has to run over them again. The rewriting is agent work through
 * `phdude write` and `phdude deslop`, gates included, and never a side effect of this command.
 *
 * @param {{store: object, clock: () => string, actor: object,
 *   loadProfile: (name: string) => Promise<object|null>}} deps
 * @param {{to?: string, apply?: boolean}} [opts]
 * @returns {Promise<{from: string, to: string, plan: object, applied: boolean,
 *   reason: string|null, path: string, revised: string[]}>}
 */
export async function adapt({ store, clock, actor, loadProfile }, { to, apply = false } = {}) {
  const project = await store.readProject();
  if (project === null) {
    throw new PhdudeError('USAGE', 'not a PhDude workspace', 'run phdude init');
  }
  // A plan is a report, so a workspace behind the current schema can still ask what a venue
  // would cost; writing the adapted manuscript into it is the part that has to wait.
  if (apply) assertUpToDate(project);

  if (typeof to !== 'string' || to.trim() === '') {
    throw new PhdudeError(
      'USAGE',
      'adapt needs a venue to adapt to',
      'phdude adapt --to ieee; phdude profile list names the venues',
    );
  }

  const manuscript = await loadManuscript(store);
  const target = await requireProfile({ loadProfile }, to.trim());
  const source = await requireProfile(
    { loadProfile },
    manuscript.target_profile ?? DEFAULT_PROFILE,
  );

  // Adapting to the venue already in force would write a second copy of the canonical manuscript
  // under another name, which is a file that can only go stale.
  if (source.name === target.name) {
    throw new PhdudeError(
      'USAGE',
      `the manuscript already targets ${target.name}`,
      'adapt moves a manuscript to another venue; phdude profile check reports this one',
    );
  }

  // Only the prose on disk is measured, the way `phdude profile check` measures it: a planned
  // section has none, and a section file that has gone missing is not counted as an empty one.
  const sections = [];
  for (const entry of manuscript.sections) {
    if (entry.status === 'planned') continue;
    const text = await store.readSection(entry.file);
    if (text === null) continue;
    sections.push({ id: entry.id, body: parseSectionFile(text).body });
  }

  const plan = planAdaptation(manuscript, sections, source, target, {
    figures: await store.listEntities('figure'),
  });
  const path = adaptedPath(target.name);

  if (!apply) {
    return {
      from: source.name,
      to: target.name,
      plan,
      applied: false,
      reason: null,
      path,
      revised: [],
    };
  }

  const adapted = adaptedManuscript(manuscript, plan, target);
  assertValid('manuscript', adapted);
  const revised = adapted.sections
    .filter((section) => section.status === 'revised')
    .map((section) => section.id);

  const existing = await store.readYaml(path);
  if (existing !== null && stableStringify(existing) === stableStringify(adapted)) {
    return {
      from: source.name,
      to: target.name,
      plan,
      applied: false,
      reason: 'up to date',
      path,
      revised,
    };
  }

  await store.writeYamlAtomic(path, adapted);
  await store.appendEvent({
    ts: clock(),
    op: 'adapt',
    actor,
    ids: [],
    summary: `manuscript adapted to ${target.name}: ${path}`,
  });

  return { from: source.name, to: target.name, plan, applied: true, reason: null, path, revised };
}

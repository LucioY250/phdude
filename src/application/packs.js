import { dirname, join } from 'node:path';
import { PhdudeError } from '../domain/errors.js';
import { scorePackDetection, recommendPacks } from '../domain/packs.js';
import { assertSkillPolicyOk } from './skills.js';
import { assertUpToDate } from './guard.js';

const FIELD_BY_KIND = { field: 'fields', method: 'methods', venue: 'venues' };

async function requireProject(store) {
  const project = await store.readProject();
  if (project === null) {
    throw new PhdudeError('USAGE', 'not a PhDude workspace', 'run phdude init');
  }
  return project;
}

function isApplied(project, pack) {
  const field = FIELD_BY_KIND[pack.kind];
  // `venues` arrived with workspace 4, so a workspace that has not migrated yet has no list at
  // all rather than an empty one.
  return field ? (project[field] ?? []).includes(pack.name) : false;
}

function sameNames(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * @param {{store: object, loadPacks: () => Promise<object[]>}} deps
 * @returns {Promise<{name: string, kind: string, description: string, applied: boolean}[]>}
 */
export async function list({ store, loadPacks }) {
  const [packs, project] = await Promise.all([loadPacks(), requireProject(store)]);
  return packs.map((p) => ({
    name: p.name,
    kind: p.kind,
    description: p.description,
    applied: isApplied(project, p),
  }));
}

/**
 * @param {{store: object, loadPacks: () => Promise<object[]>, clock: () => string, actor: object}} deps
 * @returns {Promise<{scores: object[], recommended: string[]}>}
 */
export async function detect({ store, loadPacks, clock, actor }) {
  const project = await requireProject(store);
  assertUpToDate(project);
  const packs = await loadPacks();
  const artifacts = await store.listEntities('artifact');
  const texts = [];
  for (const artifact of artifacts) {
    const text = await store.readCacheText(artifact.id);
    if (text !== null) texts.push(text);
  }

  const scores = scorePackDetection(packs, texts);
  const recommended = recommendPacks(scores);

  const current = project.packs_recommended ?? [];
  if (!sameNames(current, recommended)) {
    await store.writeProject({ ...project, packs_recommended: recommended });
    await store.appendEvent({
      ts: clock(),
      op: 'packs',
      actor,
      ids: [],
      summary: recommended.length ? `recommended: ${recommended.join(', ')}` : 'recommended: none',
    });
  }

  return { scores, recommended };
}

// A venue is applied to `venues`; the field/method lists are the ones that can be confused with
// each other, and a venue name in either of them is the same mistake in the other direction.
function otherLists(field) {
  return Object.values(FIELD_BY_KIND).filter((other) => other !== field);
}

/**
 * `loadSkill` and `loadProfile` are injected (see adapters/) so this application module never
 * imports an adapter directly.
 * @param {{store: object, loadPacks: () => Promise<object[]>, clock: () => string, actor: object,
 *   loadSkill: (dir: string) => Promise<object>,
 *   loadProfile?: (name: string) => Promise<object|null>}} deps
 * @param {string} name
 * @returns {Promise<{applied: boolean, project?: object}>}
 */
export async function apply({ store, loadPacks, clock, actor, loadSkill, loadProfile }, name) {
  const project = await requireProject(store);
  assertUpToDate(project);
  const packs = await loadPacks();
  const pack = packs.find((p) => p.name === name);
  if (!pack) throw new PhdudeError('USAGE', `unknown pack ${name}`, 'phdude packs list');

  const field = FIELD_BY_KIND[pack.kind];
  for (const otherField of otherLists(field)) {
    if ((project[otherField] ?? []).includes(name)) {
      throw new PhdudeError(
        'VALIDATION',
        `${name} is listed under ${otherField} in phdude.yaml but is a ${pack.kind} pack`,
        'fix phdude.yaml',
      );
    }
  }
  if ((project[field] ?? []).includes(name)) return { applied: false };

  // A venue pack with no profile has nothing to check a manuscript against, so applying it
  // would record a venue that never reports anything.
  if (pack.kind === 'venue') {
    const profile = loadProfile ? await loadProfile(name) : null;
    if (profile === null) {
      throw new PhdudeError(
        'VALIDATION',
        `venue pack ${name} ships no profile.yaml`,
        'a venue pack carries the profile the manuscript is checked against',
      );
    }
  }

  const policy = await store.readYaml(join('.phdude', 'research-policy.yaml'));
  for (const skillPath of pack.skillPaths) {
    const skill = await loadSkill(dirname(skillPath));
    assertSkillPolicyOk(skill, policy);
  }

  const updated = { ...project, [field]: [...(project[field] ?? []), name] };
  await store.writeProject(updated);
  await store.appendEvent({
    ts: clock(),
    op: 'packs',
    actor,
    ids: [],
    summary: `applied ${name}`,
  });
  return { applied: true, project: updated };
}

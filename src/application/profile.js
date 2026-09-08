import { PhdudeError } from '../domain/errors.js';
import { parseSectionFile } from '../domain/manuscript.js';
import { checkProfile, summarize } from '../domain/profiles.js';
import { assertUpToDate } from './guard.js';
import { loadManuscript } from './manuscript.js';

const LIST_HINT = 'phdude profile list';

/**
 * The venue the report is about: what `--profile` names, or the manuscript's `target_profile`.
 * A workspace with neither is not an error the command can guess its way out of.
 * @param {object|null} manuscript
 * @param {string|null|undefined} requested
 * @returns {string}
 */
function targetOf(manuscript, requested) {
  if (typeof requested === 'string' && requested.trim() !== '') return requested.trim();
  const target = manuscript?.target_profile;
  if (typeof target === 'string' && target.trim() !== '') return target.trim();
  throw new PhdudeError(
    'USAGE',
    'no venue profile to report on',
    'phdude profile use <venue>, or pass --profile <venue>',
  );
}

/**
 * The loader reports a venue it does not ship as null so the writing gates can stay silent about
 * it (adapters/packs/loader.js); a command the researcher ran on purpose says so instead.
 * @param {{loadProfile: (name: string) => Promise<object|null>}} deps
 * @param {string} name
 * @returns {Promise<object>}
 */
export async function requireProfile({ loadProfile }, name) {
  const profile = await loadProfile(name);
  if (profile === null) {
    throw new PhdudeError('USAGE', `unknown venue: ${name}`, LIST_HINT);
  }
  return profile;
}

async function readProject(store) {
  const project = await store.readProject();
  if (project === null) {
    throw new PhdudeError('USAGE', 'not a PhDude workspace', 'run phdude init');
  }
  return project;
}

/**
 * @param {{store: object, loadProfiles: () => Promise<object[]>}} deps
 * @returns {Promise<{name: string, display: string, description: string|null,
 *   document_class: string, sections: number, applied: boolean, active: boolean}[]>}
 */
export async function list({ store, loadProfiles }) {
  const project = await readProject(store);
  const manuscript = await store.readManuscript();
  const applied = new Set(project.venues ?? []);
  const active = manuscript?.target_profile ?? null;

  return (await loadProfiles()).map((profile) => ({
    name: profile.name,
    display: profile.display,
    description: profile.description ?? null,
    document_class: profile.document_class,
    sections: profile.sections.length,
    applied: applied.has(profile.name),
    active: profile.name === active,
  }));
}

/**
 * @param {{store: object, loadProfile: (name: string) => Promise<object|null>}} deps
 * @param {{profile?: string}} [input]
 * @returns {Promise<object>} the resolved profile, plus whether it is applied and active
 */
export async function show({ store, loadProfile }, { profile: requested } = {}) {
  const project = await readProject(store);
  const manuscript = await store.readManuscript();
  const name = targetOf(manuscript, requested);
  const profile = await requireProfile({ loadProfile }, name);

  return {
    ...profile,
    applied: (project.venues ?? []).includes(name),
    active: manuscript?.target_profile === name,
  };
}

/**
 * Every venue rule the manuscript can be judged against without rendering it (spec §3.2). It
 * reads and reports; the caller turns a `block` into exit 2.
 * @param {{store: object, loadProfile: (name: string) => Promise<object|null>}} deps
 * @param {{profile?: string}} [input]
 * @returns {Promise<{profile: string, display: string, findings: object[],
 *   counts: {block: number, warn: number, info: number}, blocked: boolean}>}
 */
export async function check({ store, loadProfile }, { profile: requested } = {}) {
  await readProject(store);
  const manuscript = await loadManuscript(store);
  const name = targetOf(manuscript, requested);
  const profile = await requireProfile({ loadProfile }, name);

  // Only the prose that is on disk is measured. A planned section has none, and a section file
  // that has gone missing is reported as unwritten rather than as an empty one.
  const sections = [];
  for (const entry of manuscript.sections) {
    if (entry.status === 'planned') continue;
    const text = await store.readSection(entry.file);
    if (text === null) continue;
    sections.push({ id: entry.id, body: parseSectionFile(text).body });
  }

  const findings = checkProfile(manuscript, sections, profile, {
    figures: await store.listEntities('figure'),
  });
  const counts = summarize(findings);

  return {
    profile: profile.name,
    display: profile.display,
    findings,
    counts,
    blocked: counts.block > 0,
  };
}

/**
 * @param {{store: object, clock: () => string, actor: object,
 *   loadProfile: (name: string) => Promise<object|null>}} deps
 * @param {string} name
 * @returns {Promise<{profile: string, changed: boolean}>}
 */
export async function use({ store, clock, actor, loadProfile }, name) {
  const project = await readProject(store);
  assertUpToDate(project);

  if (!name) {
    throw new PhdudeError('USAGE', 'profile use needs a venue name', LIST_HINT);
  }
  const profile = await requireProfile({ loadProfile }, name);
  const manuscript = await loadManuscript(store);
  if (manuscript.target_profile === profile.name) {
    return { profile: profile.name, changed: false };
  }

  await store.writeManuscript({ ...manuscript, target_profile: profile.name });
  await store.appendEvent({
    ts: clock(),
    op: 'profile',
    actor,
    ids: [],
    summary: `target profile ${profile.name}`,
  });
  return { profile: profile.name, changed: true };
}

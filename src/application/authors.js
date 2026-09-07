import { readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { newDecision } from '../domain/entities.js';
import { stableStringify } from '../domain/normalize.js';
import { consensus as buildConsensus, learnFrom } from '../domain/voice.js';
import { PhdudeError } from '../domain/errors.js';
import { assertValid } from '../schemas/index.js';
import { assertUpToDate } from './guard.js';

const AUTHORS_DIR = 'authors';
const CONSENSUS_ID = 'project-consensus';
const ID_RE = /^[a-z0-9-]+$/;

// Fields an `authors add --json` payload may set. `learned` and `samples` are written only by
// `learn`, never accepted here directly - they are derived, not hand-typed.
export const ALLOWED_FIELDS = [
  'id',
  'name',
  'email',
  'language',
  'tone',
  'sentences',
  'paragraphs',
  'transitions',
  'terminology',
];

function pathFor(id) {
  return join(AUTHORS_DIR, `${id}.yaml`);
}

function assertValidId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new PhdudeError(
      'VALIDATION',
      `invalid author id: ${id}`,
      'author ids look like researcher-a: lowercase letters, digits and hyphens only',
    );
  }
}

async function readProfile(store, id) {
  return store.readYaml(pathFor(id));
}

async function listProfileIds(store) {
  let files;
  try {
    files = await readdir(join(store.root, AUTHORS_DIR));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return files
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.slice(0, -'.yaml'.length))
    .sort();
}

function assertKnownFields(input) {
  const unknown = Object.keys(input ?? {})
    .filter((k) => !ALLOWED_FIELDS.includes(k))
    .sort();
  if (unknown.length > 0) {
    throw new PhdudeError(
      'VALIDATION',
      `unknown field(s) for author profile: ${unknown.join(', ')}`,
      `allowed: ${ALLOWED_FIELDS.join(', ')}`,
    );
  }
}

// Where a sample path is recorded: relative to the workspace when it lives inside it (the
// common case - `authors/samples/<id>/*.md`), or the resolved absolute path otherwise. Unlike
// `phdude ingest`, a sample is never required to live inside the workspace: a researcher may
// point `learn` at a chapter draft anywhere on disk.
function sampleRecordPath(cwd, root, requestedPath) {
  const abs = resolve(cwd, requestedPath);
  const rel = relative(root, abs);
  const inside = !rel.startsWith('..') && !isAbsolute(rel);
  return (inside ? rel : abs).split(sep).join('/');
}

/**
 * @param {{store: object}} deps
 * @returns {Promise<object[]>} every author profile, `project-consensus` included, sorted by id
 */
export async function list({ store }) {
  const ids = await listProfileIds(store);
  const profiles = [];
  for (const id of ids) profiles.push(await readProfile(store, id));
  return profiles;
}

/**
 * @param {{store: object}} deps
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function show({ store }, id) {
  const profile = await readProfile(store, id);
  if (!profile) {
    throw new PhdudeError('USAGE', `not found: author ${id}`, 'run phdude authors list');
  }
  return profile;
}

/**
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {object} fields - `id`, `language`, `tone`, `sentences`, `paragraphs`, `transitions`
 *   required; `name`, `email`, `terminology` optional
 * @returns {Promise<object>} the written profile
 */
export async function add({ store, clock, actor }, fields) {
  assertUpToDate(await store.readProject());
  assertKnownFields(fields);

  const id = fields?.id;
  assertValidId(id);
  if (id === CONSENSUS_ID) {
    throw new PhdudeError(
      'VALIDATION',
      `${CONSENSUS_ID} is reserved for phdude authors consensus`,
      'pick a different id',
    );
  }

  if (await store.exists(pathFor(id))) {
    throw new PhdudeError(
      'VALIDATION',
      `author profile ${id} already exists`,
      `run phdude authors show ${id}, or pick a different id`,
    );
  }

  const profile = {
    schema: 'phdude.author-profile',
    version: 1,
    id,
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(fields.email !== undefined ? { email: fields.email } : {}),
    language: fields.language,
    tone: fields.tone,
    sentences: fields.sentences,
    paragraphs: fields.paragraphs,
    transitions: fields.transitions,
    terminology: fields.terminology ?? { preserve: [], avoid: [] },
    samples: [],
  };
  assertValid('author-profile', profile);

  await store.writeYamlAtomic(pathFor(id), profile);
  await store.appendEvent({
    ts: clock(),
    op: 'authors',
    actor,
    ids: [],
    summary: `author profile ${id} added`,
  });
  return profile;
}

/**
 * Recomputes `learned` from exactly the samples passed in this call (not the profile's whole
 * history) and merges them into `samples[]` by path: one entry per file, and an entry already
 * on record keeps `approved: true` unless this call raises it. Rerunning `learn` over samples
 * that have not changed writes nothing at all, `learned_at` included - the same rule
 * `consensus` follows, and the ordinary case for a researcher who reruns the command.
 * @param {{store: object, clock: () => string, actor: object, cwd: string,
 *   readText: (path: string) => Promise<string>}} deps
 * @param {string} id
 * @param {{paths: string[], approved?: boolean}} opts
 * @returns {Promise<object>} the profile, updated or exactly as it was
 */
export async function learn(
  { store, clock, actor, cwd, readText },
  id,
  { paths = [], approved = false } = {},
) {
  assertUpToDate(await store.readProject());
  assertValidId(id);

  if (paths.length === 0) {
    throw new PhdudeError(
      'USAGE',
      'authors learn needs at least one --from <path>',
      `phdude authors learn ${id} --from <path…> [--approved]`,
    );
  }

  const profile = await readProfile(store, id);
  if (!profile) {
    throw new PhdudeError('USAGE', `not found: author ${id}`, 'run phdude authors list');
  }

  const texts = [];
  const newSamples = [];
  for (const requested of paths) {
    let text;
    try {
      text = await readText(requested);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        throw new PhdudeError('USAGE', `no such file: ${requested}`, null);
      }
      throw err;
    }
    texts.push(text);
    newSamples.push({ path: sampleRecordPath(cwd, store.root, requested), approved });
  }

  const merged = {
    ...profile,
    learned: learnFrom(texts, profile.language),
    samples: mergeSamples(profile.samples, newSamples),
  };

  if (stableStringify(withoutLearnedAt(profile)) === stableStringify(merged)) {
    await store.appendEvent({
      ts: clock(),
      op: 'authors',
      actor,
      ids: [],
      summary: `author profile ${id} voice unchanged`,
    });
    return profile;
  }

  const updated = { ...merged, learned: { ...merged.learned, learned_at: clock() } };
  assertValid('author-profile', updated);

  await store.writeYamlAtomic(pathFor(id), updated);
  await store.appendEvent({
    ts: clock(),
    op: 'authors',
    actor,
    ids: [],
    summary: `author profile ${id} learned from ${newSamples.length} sample(s)`,
  });
  return updated;
}

// One entry per path, and an approval already on record survives a rerun that does not pass
// `--approved`: the record of approved samples is what spec §3.2 says `samples[]` is.
function mergeSamples(existing, added) {
  const merged = (existing ?? []).map((sample) => ({ ...sample }));
  for (const sample of added) {
    const found = merged.find((entry) => entry.path === sample.path);
    if (!found) merged.push(sample);
    else if (sample.approved === true) found.approved = true;
  }
  return merged;
}

function withoutLearnedAt(profile) {
  if (!profile?.learned) return profile;
  const learned = { ...profile.learned };
  delete learned.learned_at;
  return { ...profile, learned };
}

/**
 * Merges every author profile (except `project-consensus` itself) into `project-consensus`.
 * The file is written only when the merged content differs from what is already on disk
 * (`learned.learned_at` excluded, since a timestamp is not content): rerunning `consensus` with
 * nothing new to merge leaves the file byte for byte as it was. A real change also proposes a
 * Decision recording the voice it proposes - constructed and written directly here (not via
 * `decide.propose`) so this remains one event for the whole operation, and keyed on the merged
 * voice itself, so recomputing the same consensus finds the same Decision instead of proposing
 * a second copy of it.
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @returns {Promise<{changed: boolean, decision: object|null, profile: object}>}
 */
export async function consensus({ store, clock, actor }) {
  assertUpToDate(await store.readProject());

  const ids = (await listProfileIds(store)).filter((id) => id !== CONSENSUS_ID);
  if (ids.length === 0) {
    throw new PhdudeError(
      'USAGE',
      'no author profiles to build a consensus from',
      'phdude authors add --json \'{"id":"researcher-a",…}\'',
    );
  }

  const profiles = [];
  for (const id of ids) profiles.push(await readProfile(store, id));

  const merged = buildConsensus(profiles);
  const previous = await readProfile(store, CONSENSUS_ID);
  const changed = stableStringify(withoutLearnedAt(previous)) !== stableStringify(merged);

  if (!changed) {
    await store.appendEvent({
      ts: clock(),
      op: 'authors',
      actor,
      ids: [],
      summary: 'project-consensus voice unchanged',
    });
    return { changed: false, decision: null, profile: previous };
  }

  const toWrite = merged.learned
    ? { ...merged, learned: { ...merged.learned, learned_at: clock() } }
    : merged;
  assertValid('author-profile', toWrite);
  await store.writeYamlAtomic(pathFor(CONSENSUS_ID), toWrite);

  const candidate = newDecision({
    title: 'Update project-consensus voice',
    rationale: `Recomputed the project-consensus voice from ${ids.length} author profile(s): ${ids.join(', ')}.`,
    proposed_by: actor,
    affects: [],
    // `merged` carries no `learned_at` - the clock is stamped on the copy that is written - so
    // the Decision's id keys off the proposed voice and nothing else.
    change: { consensus: { participants: ids, voice: merged } },
    created: clock(),
  });
  const existing = await store.readEntity(candidate.id);
  if (!existing) await store.writeEntity(candidate);

  await store.appendEvent({
    ts: clock(),
    op: 'authors',
    actor,
    ids: [],
    summary: 'project-consensus voice updated',
  });

  return { changed: true, decision: existing ?? candidate, profile: toWrite };
}

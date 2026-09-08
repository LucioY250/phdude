// The mechanics every example workspace under examples/ is built with: a fixed clock, a stubbed
// git and fetch, a pinned execution runtime, and thin wrappers over the use cases whose call
// shape is the same whatever the field is. Nothing here knows what an example is about - a
// profile (scripts/make-example.mjs, scripts/make-examples.mjs) supplies that - which is what
// lets the same builder produce a thesis, a survey study, a benchmark paper and an archival
// study without the builder branching on any of them.
import { readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { walk, read, realpath } from '../../src/adapters/store/fs-walk.js';
import { detectKind, parseTable, parserFor } from '../../src/adapters/documents/index.js';
import { DEFAULT_PACKS_DIR, discoverPacks, loadProfile } from '../../src/adapters/packs/loader.js';
import { discoverSkills, loadSkill } from '../../src/adapters/skills/loader.js';
import { localRunner } from '../../src/adapters/execution/local.js';
import { DEFAULT_GENERATORS_DIR } from '../../src/adapters/execution/generators.js';
import { initWorkspace } from '../../src/application/init.js';
import { ingest } from '../../src/application/ingest.js';
import { approve as approveDecision, propose } from '../../src/application/decide.js';
import * as authors from '../../src/application/authors.js';
import * as research from '../../src/application/research.js';
import * as review from '../../src/application/review.js';
import * as manuscript from '../../src/application/manuscript.js';
import { buildProviders } from '../../src/adapters/search/index.js';
import { fakeFetch } from '../../src/adapters/search/fake-fetch.js';

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXAMPLES_DIR = join(PACKAGE_ROOT, 'examples');

export const ACTOR = { researcher: 'example', agent: 'script' };

// Only ever seen by a provider's User-Agent header, and the stubbed fetch below ignores it; a
// fixed string keeps the generator's output independent of the package version.
export const EXAMPLE_VERSION = 'example';

// DOS/FAT timestamps aside, a plain fixed mtime keeps ingest's artifact.mtime field (and hence
// the written YAML) stable across regenerations, independent of when this script happens to run.
export const FIXED_MTIME = new Date('2026-08-15T00:00:00Z');

// A fixed clock, advancing 1s per call, so every timestamp the generator writes is stable
// across regenerations - the whole point of this script being safe to diff or re-run in CI.
export function makeClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 8, 1, 0, 0, tick++)).toISOString();
}

// A stub git adapter: the examples live inside PhDude's own repository already, so isInsideRepo
// reports true and initWorkspace never touches git for real.
export const fakeGit = {
  isInsideRepo: async () => true,
  initRepo: async () => {
    throw new Error('fakeGit.initRepo should never be called (isInsideRepo already reports true)');
  },
  userName: async () => 'example',
};

// Two things about a real run cannot be committed: which `node` happens to be on PATH, and how
// long the script took. An example's policy stays closed (`execution.enabled: false`) and names
// `node` like every other workspace; the generator pins the run to this process's own executable
// and its duration to zero, so regenerating produces the same bytes on any machine.
export const pinnedRunner = {
  name: localRunner.name,
  available: (runtime) => localRunner.available(runtime),
  run: async (options) => {
    const result = await localRunner.run({ ...options, runtime: process.execPath });
    return { ...result, durationMs: 0 };
  },
};

export function makeDeps(root) {
  return {
    store: new FsStore(root),
    clock: makeClock(),
    actor: ACTOR,
    loadPacks: () => discoverPacks([DEFAULT_PACKS_DIR]),
    loadProfile: (name) => loadProfile(name),
    loadSkill,
  };
}

// The extra ports the analysis half of an example needs: a runner whose output is reproducible,
// the bytes and real paths `repro check` hashes, a table parser, and the shipped generators.
export function withAnalysis(deps, root) {
  return {
    ...deps,
    runner: pinnedRunner,
    readBytes: (rel) => read(join(root, rel)),
    realpath,
    parseTable,
    generatorsDir: DEFAULT_GENERATORS_DIR,
  };
}

export async function writeSources(store, files) {
  for (const [relPath, text] of Object.entries(files)) {
    await store.writeTextAtomic(relPath, text);
    await utimes(join(store.root, relPath), FIXED_MTIME, FIXED_MTIME);
  }
}

export function artifactIdFor(artifacts, relPath) {
  const found = artifacts.find((a) => a.paths.includes(relPath));
  if (!found) throw new Error(`artifact not found for ${relPath}`);
  return found.id;
}

// OpenAlex ships abstracts as a word -> positions index for copyright reasons, so a stubbed
// response has to speak the same shape the real adapter reads.
export function invertedAbstract(text) {
  const index = {};
  text.split(' ').forEach((word, position) => {
    (index[word] ??= []).push(position);
  });
  return index;
}

// arXiv answers in Atom, not JSON, so a stubbed response for it is a feed rather than an object.
export function atomFeed(entries) {
  const body = entries
    .map((entry) =>
      [
        '  <entry>',
        `    <id>http://arxiv.org/abs/${entry.id}</id>`,
        `    <published>${entry.published}</published>`,
        `    <title>${entry.title}</title>`,
        `    <summary>${entry.summary}</summary>`,
        ...entry.authors.map((name) => `    <author><name>${name}</name></author>`),
        `    <link title="pdf" href="http://arxiv.org/pdf/${entry.id}" rel="related"/>`,
        '  </entry>',
      ].join('\n'),
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n${body}\n</feed>\n`;
}

/**
 * One literature search, answered from recorded routes rather than the network, at a date the
 * caller picks. A search dated the same day as everything else would never age, so an example
 * that wants `phdude gaps` and `phdude next` to call a search stale winds the clock back.
 */
export async function recordSearch(deps, { query, question, at, provider, routes }) {
  const fetch = fakeFetch(routes);
  const { candidates } = await research.search(
    {
      ...deps,
      clock: () => at,
      providers: buildProviders([provider], { fetch, env: {}, version: EXAMPLE_VERSION }),
    },
    { query, question, allowNetwork: true },
  );
  return candidates.created;
}

// One of the returned candidates has been reviewed and accepted; the rest stay in the queue.
// That is what a real queue looks like, and it is what puts a source in the registry that was
// found rather than ingested - `phdude cite list` shows it, `phdude knowledge trace` shows where
// it came from.
export async function acceptCandidate(deps, candidateIds, { type = 'article', approve } = {}) {
  for (const id of candidateIds) {
    const candidate = await deps.store.readEntity(id);
    if (candidate.type !== type) continue;
    return research.accept(deps, id, approve);
  }
  throw new Error(`no ${type} candidate to accept`);
}

export async function submitDraft(deps, section, body, options) {
  const path = join(deps.store.root, `draft-${section}.md`);
  await writeFile(path, body + '\n');
  await manuscript.submit(
    { ...deps, readText: () => readFile(path, 'utf8') },
    { section, file: path, ...options },
  );
  await rm(path);
}

// The human-authority gate: a section reaches `approved` only behind an approved Decision, so
// an example that carries an approved section carries the decision that approved it too.
export async function approveSection(deps, { section, title, rationale }) {
  const { obj: decision } = await propose(deps, {
    title,
    rationale,
    affects: [`manuscript:${section}`],
  });
  await approveDecision(deps, decision.id, { by: ACTOR.researcher });
  await manuscript.approve(deps, { section, decision: decision.id });
}

// One author profile, learned from one approved sample - `phdude authors learn`'s paths are
// resolved relative to the current directory, so this mirrors the CLI's own resolution rather
// than `store.readText` (workspace-root-relative).
export async function addAuthorProfile(deps, root, authorProfile, sample) {
  await authors.add(deps, authorProfile);

  const samplePath = join('authors', 'samples', authorProfile.id, 'intro-approved.md');
  await deps.store.writeTextAtomic(samplePath, sample);

  await authors.learn(
    { ...deps, cwd: root, readText: (p) => readFile(resolve(root, p), 'utf8') },
    authorProfile.id,
    { paths: [samplePath], approved: true },
  );
}

// One recorded review, so an example carries the v0.7 loop and not only its commands. It stays
// open: accepting, dismissing or resolving a finding is the researcher's call, and an example
// that had already made it would be showing the wrong half of the loop.
export async function recordReview(deps, kind, findings) {
  const path = join(deps.store.root, 'findings.json');
  await writeFile(path, JSON.stringify({ findings }, null, 2) + '\n');
  await review.submit({ ...deps, readText: () => readFile(path, 'utf8') }, { file: path, kind });
  await rm(path);
}

/**
 * Builds one example workspace from a profile: `{ title, sources, build }`. Everything before
 * `build` is the same in every field - a workspace, its source files, and one ingest pass - and
 * everything after it is the profile's own research.
 * @param {string} root
 * @param {{title: string, sources: Record<string, string>,
 *   build: (deps: object, ctx: object) => Promise<void>}} profile
 */
export async function buildExample(root, profile) {
  await rm(root, { recursive: true, force: true });

  const deps = makeDeps(root);

  await initWorkspace(
    { ...deps, git: fakeGit, agentHosts: [], discoverSkills },
    { title: profile.title, agents: [], noGit: false },
  );

  await writeSources(deps.store, profile.sources);

  const { artifacts } = await ingest(
    { ...deps, fs: { walk, read, realpath }, parsers: { detectKind, parserFor } },
    { paths: ['sources'] },
  );

  await profile.build(deps, {
    root,
    artifacts,
    artifactId: (relPath) => artifactIdFor(artifacts, relPath),
  });
}

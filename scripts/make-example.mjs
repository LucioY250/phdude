#!/usr/bin/env node
// Regenerates examples/generic-thesis/ by driving the real use cases (initWorkspace, ingest,
// addEntity, decide.propose, promote) against a fixed clock, so the committed workspace is a
// faithful, reproducible sample rather than hand-authored YAML.
import { rm, utimes } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../src/adapters/store/fs-store.js';
import { walk, read } from '../src/adapters/store/fs-walk.js';
import { detectKind, parserFor } from '../src/adapters/documents/index.js';
import { initWorkspace } from '../src/application/init.js';
import { ingest } from '../src/application/ingest.js';
import { addEntity } from '../src/application/add.js';
import { promote, propose } from '../src/application/decide.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(PACKAGE_ROOT, 'examples', 'generic-thesis');

const ACTOR = { researcher: 'example', agent: 'script' };

// A fixed clock, advancing 1s per call, so every timestamp the generator writes is stable
// across regenerations - the whole point of this script being safe to diff or re-run in CI.
function makeClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 8, 1, 0, 0, tick++)).toISOString();
}

// A stub git adapter: examples/generic-thesis lives inside PhDude's own repository already, so
// isInsideRepo reports true and initWorkspace never touches git for real.
const fakeGit = {
  isInsideRepo: async () => true,
  initRepo: async () => {
    throw new Error('fakeGit.initRepo should never be called (isInsideRepo already reports true)');
  },
  userName: async () => 'example',
};

const SOURCE_FILES = {
  'sources/survey-alpha.md': `# Survey Alpha

## Methods

We surveyed 312 undergraduate students about their use of mobile note-taking apps during
lectures, recruited through the university's main mailing list.

## Results

Most respondents reported daily use of at least one note-taking application.
`,
  'sources/survey-beta.md': `# Survey Beta

## Methods

An independent survey of 300 undergraduate students examined the same question using a
different recruitment channel (a campus social media group).

## Results

Reported daily use was slightly lower than in Survey Alpha.
`,
  'sources/survey-gamma.md': `# Survey Gamma

## Methods

A third, unaffiliated survey of 312 undergraduate students corroborates the Survey Alpha
sample size, using stratified sampling across three campuses.

## Results

Findings are broadly consistent with Survey Alpha.
`,
  'sources/participants.csv': `metric,value\ncountry,Peru\n`,
};

// DOS/FAT timestamps aside, a plain fixed mtime keeps ingest's artifact.mtime field (and hence
// the written YAML) stable across regenerations, independent of when this script happens to run.
const FIXED_MTIME = new Date('2026-08-15T00:00:00Z');

async function writeSources(store) {
  for (const [relPath, text] of Object.entries(SOURCE_FILES)) {
    await store.writeTextAtomic(relPath, text);
    await utimes(join(store.root, relPath), FIXED_MTIME, FIXED_MTIME);
  }
}

function artifactIdFor(artifacts, relPath) {
  const found = artifacts.find((a) => a.paths.includes(relPath));
  if (!found) throw new Error(`artifact not found for ${relPath}`);
  return found.id;
}

export async function generate(root) {
  await rm(root, { recursive: true, force: true });

  const clock = makeClock();
  const deps = { store: new FsStore(root), clock, actor: ACTOR };

  await initWorkspace(
    { ...deps, git: fakeGit, agentHosts: [] },
    { title: 'Generic Thesis Example', agents: [], noGit: false },
  );

  await writeSources(deps.store);

  const { artifacts } = await ingest(
    { ...deps, fs: { walk, read }, parsers: { detectKind, parserFor } },
    { paths: ['sources'] },
  );

  const artAlpha = artifactIdFor(artifacts, 'sources/survey-alpha.md');
  const artBeta = artifactIdFor(artifacts, 'sources/survey-beta.md');
  const artGamma = artifactIdFor(artifacts, 'sources/survey-gamma.md');
  const artCsv = artifactIdFor(artifacts, 'sources/participants.csv');

  await addEntity(deps, 'source', {
    title: 'Survey Alpha and Beta: Note-Taking App Adoption',
    authors: ['A. Alpha', 'B. Beta'],
    year: 2025,
    type: 'report',
    artifacts: [artAlpha, artBeta],
  });
  await addEntity(deps, 'source', {
    title: 'Survey Gamma: Cross-Campus Replication',
    authors: ['C. Gamma'],
    year: 2025,
    type: 'report',
    artifacts: [artGamma],
  });

  const { obj: rq } = await addEntity(deps, 'question', {
    text: 'Does mobile note-taking app adoption differ across recruitment channels and campuses?',
    objectives: ['Compare adoption rates across independently recruited student surveys.'],
  });

  const { obj: evidence1 } = await addEntity(deps, 'evidence', {
    source: artAlpha,
    locator: 'Methods',
    excerpt:
      '312 undergraduate students reported daily use of at least one note-taking application (Survey Alpha).',
    strength: 'moderate',
  });

  const { obj: claim1 } = await addEntity(deps, 'claim', {
    statement:
      'Daily use of mobile note-taking apps is common among surveyed undergraduate students.',
    kind: 'empirical',
    supported_by: [evidence1.id],
    questions: [rq.id],
    sections: ['Results'],
  });
  await promote(deps, claim1.id, { to: 'supported' });

  await addEntity(deps, 'claim', {
    statement: 'Note-taking app adoption may vary by recruitment channel.',
    kind: 'empirical',
  });
  await addEntity(deps, 'claim', {
    statement: 'Stratified sampling across campuses corroborates the observed adoption rate.',
    kind: 'methodological',
  });

  // Fact ids are content-derived from `key + value` only (see domain/ids.js), so two facts
  // sharing a key and value collapse to the same id regardless of their source artifact - a
  // second `312` fact from Gamma would silently no-op onto the Alpha fact instead of creating a
  // distinct record. A two-value conflict (Alpha 312 vs Beta 300) is the pattern the real
  // add-entity pipeline can actually produce; it is still a fully valid conflict for
  // `detectFactConflicts` (see most of tests/unit/domain/conflicts.test.js).
  const { obj: fact1 } = await addEntity(deps, 'fact', {
    key: 'sample_size',
    value: 312,
    unit: 'participants',
    from: { artifact: artAlpha, locator: 'Methods' },
  });
  const { obj: fact2 } = await addEntity(deps, 'fact', {
    key: 'sample_size',
    value: 300,
    unit: 'participants',
    from: { artifact: artBeta, locator: 'Methods' },
  });
  await addEntity(deps, 'fact', {
    key: 'country',
    value: 'Peru',
    from: { artifact: artCsv, locator: 'row 2' },
  });
  await addEntity(deps, 'fact', {
    key: 'sampling_method',
    value: 'stratified',
    from: { artifact: artGamma, locator: 'Methods' },
  });

  await propose(deps, {
    title: 'Resolve sample_size discrepancy between Survey Alpha and Survey Beta',
    rationale:
      'Survey Alpha reports 312 participants while Survey Beta reports 300; reconcile before ' +
      'citing a canonical sample size.',
    affects: [fact1.id, fact2.id],
    change: { fact_key: 'sample_size', canonical_value: 312 },
  });
}

async function main() {
  await generate(ROOT);
  console.log(`generated ${ROOT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import * as authors from '../../src/application/authors.js';
import { PhdudeError } from '../../src/domain/errors.js';

const actor = { researcher: 'test', agent: 'node' };

function makeDeps(root) {
  let tick = 0;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
    actor,
  };
}

function readTextRelativeTo(cwd) {
  return (p) => readFile(resolve(cwd, p), 'utf8');
}

// No `phdude.yaml` is written: a workspace with none is treated as needing no migration
// (see `application/guard.js`), the same shortcut the other integration tests take.
async function newWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'phdude-authors-'));
  await mkdir(join(root, 'authors'), { recursive: true });
  return root;
}

const PROFILE_FIELDS = {
  id: 'researcher-a',
  language: 'en',
  tone: { academic: true, assertiveness: 'moderate', first_person: 'sparing' },
  sentences: { length: 'varied', openings: 'varied' },
  paragraphs: { density: 'medium' },
  transitions: 'minimal',
  terminology: { preserve: ['decision process'], avoid: ['leverage'] },
};

test('add: writes a valid profile, refuses overwrite, refuses a bad id, one event', async () => {
  const root = await newWorkspace();
  const deps = makeDeps(root);

  const profile = await authors.add(deps, PROFILE_FIELDS);
  assert.equal(profile.id, 'researcher-a');
  assert.equal(profile.schema, 'phdude.author-profile');
  assert.deepEqual(profile.samples, []);
  assert.equal(profile.learned, undefined);

  const onDisk = await deps.store.readYaml(join('authors', 'researcher-a.yaml'));
  assert.deepEqual(onDisk, profile);

  await assert.rejects(
    () => authors.add(deps, PROFILE_FIELDS),
    (err) => err instanceof PhdudeError && /already exists/.test(err.message),
  );

  await assert.rejects(
    () => authors.add(deps, { ...PROFILE_FIELDS, id: 'Researcher_B' }),
    (err) => err instanceof PhdudeError && /invalid author id/.test(err.message),
  );

  await assert.rejects(
    () => authors.add(deps, { ...PROFILE_FIELDS, id: 'researcher-b', extra: 'nope' }),
    (err) => err instanceof PhdudeError && /unknown field/.test(err.message),
  );

  await assert.rejects(
    () => authors.add(deps, { ...PROFILE_FIELDS, id: 'project-consensus' }),
    (err) => err instanceof PhdudeError && /reserved/.test(err.message),
  );

  const events = await deps.store.readEvents();
  assert.deepEqual(
    events.map((e) => e.op),
    ['authors'],
  );
  assert.deepEqual(events[0].ids, []);
  assert.match(events[0].summary, /author profile researcher-a added/);
});

test('learn: reads samples relative to cwd, records learned and samples[]', async () => {
  const root = await newWorkspace();
  const deps = makeDeps(root);
  await authors.add(deps, PROFILE_FIELDS);

  await mkdir(join(root, 'authors', 'samples', 'researcher-a'), { recursive: true });
  await writeFile(
    join(root, 'authors', 'samples', 'researcher-a', 'a.md'),
    'We surveyed 312 students. However, adoption varies across campuses.',
  );

  const outsideDir = await mkdtemp(join(tmpdir(), 'phdude-outside-'));
  await writeFile(
    join(outsideDir, 'b.md'),
    'A second sample lives outside the workspace entirely.',
  );

  const updated = await authors.learn(
    { ...deps, cwd: root, readText: readTextRelativeTo(root) },
    'researcher-a',
    { paths: [join('authors', 'samples', 'researcher-a', 'a.md'), join(outsideDir, 'b.md')] },
  );

  assert.ok(updated.learned);
  assert.equal(updated.learned.sample_count, 2);
  assert.equal(typeof updated.learned.learned_at, 'string');
  assert.equal(updated.samples.length, 2);
  assert.equal(updated.samples[0].path, 'authors/samples/researcher-a/a.md');
  assert.equal(updated.samples[0].approved, false);
  assert.equal(updated.samples[1].path, join(outsideDir, 'b.md'));
  assert.equal(updated.samples[1].approved, false);

  const onDisk = await deps.store.readYaml(join('authors', 'researcher-a.yaml'));
  assert.deepEqual(onDisk, updated);

  const events = await deps.store.readEvents();
  assert.deepEqual(
    events.map((e) => e.op),
    ['authors', 'authors'],
  );
  assert.match(events[1].summary, /learned from 2 sample\(s\)/);
});

test('learn: --approved marks the new sample entries approved; a missing file is a usage error', async () => {
  const root = await newWorkspace();
  const deps = makeDeps(root);
  await authors.add(deps, PROFILE_FIELDS);
  await writeFile(join(root, 'a.md'), 'Some approved prose about the study, written plainly.');

  const updated = await authors.learn(
    { ...deps, cwd: root, readText: readTextRelativeTo(root) },
    'researcher-a',
    { paths: ['a.md'], approved: true },
  );
  assert.equal(updated.samples[0].approved, true);

  await assert.rejects(
    () =>
      authors.learn({ ...deps, cwd: root, readText: readTextRelativeTo(root) }, 'researcher-a', {
        paths: ['missing.md'],
      }),
    (err) => err instanceof PhdudeError && /no such file/.test(err.message),
  );

  await assert.rejects(
    () =>
      authors.learn({ ...deps, cwd: root, readText: readTextRelativeTo(root) }, 'no-such-author', {
        paths: ['a.md'],
      }),
    (err) => err instanceof PhdudeError && /not found/.test(err.message),
  );
});

test('consensus: merges profiles, proposes a Decision once, then is a no-op until something changes', async () => {
  const root = await newWorkspace();
  const deps = makeDeps(root);

  await authors.add(deps, PROFILE_FIELDS);
  await authors.add(deps, {
    ...PROFILE_FIELDS,
    id: 'researcher-b',
    tone: { academic: true, assertiveness: 'high', first_person: 'natural' },
    terminology: { preserve: ['decision process', 'edge case'], avoid: ['leverage', 'robust'] },
  });

  const first = await authors.consensus(deps);
  assert.equal(first.changed, true);
  assert.ok(first.decision);
  assert.equal(first.decision.title, 'Update project-consensus voice');
  assert.deepEqual(first.decision.affects, []);
  assert.deepEqual(first.decision.change.consensus.participants, ['researcher-a', 'researcher-b']);
  assert.deepEqual(first.profile.terminology.preserve, ['decision process', 'edge case']);
  assert.deepEqual(first.profile.terminology.avoid, ['leverage']);

  const onDisk = await deps.store.readYaml(join('authors', 'project-consensus.yaml'));
  assert.deepEqual(onDisk, first.profile);

  const second = await authors.consensus(deps);
  assert.equal(second.changed, false);
  assert.equal(second.decision, null);

  const events = await deps.store.readEvents();
  const decideEvents = events.filter((e) => e.op === 'decide');
  const authorsEvents = events.filter((e) => e.op === 'authors');
  assert.equal(
    decideEvents.length,
    0,
    'the decision is written directly, not through decide.propose',
  );
  // 2 `add` + 2 `consensus` (this test's own calls so far).
  assert.equal(authorsEvents.length, 4);
  assert.match(authorsEvents[2].summary, /updated/);
  assert.match(authorsEvents[3].summary, /unchanged/);

  // A third run after actually learning something new must change the consensus again and
  // propose a second (distinct) decision - not silently reuse the first.
  await writeFile(join(root, 'sample.md'), 'Fresh approved prose to learn from, for this test.');
  await authors.learn({ ...deps, cwd: root, readText: readTextRelativeTo(root) }, 'researcher-a', {
    paths: ['sample.md'],
  });
  const third = await authors.consensus(deps);
  assert.equal(third.changed, true);
  assert.notEqual(third.decision.id, first.decision.id);
});

test('consensus: refuses when there are no author profiles yet', async () => {
  const root = await newWorkspace();
  const deps = makeDeps(root);
  await assert.rejects(
    () => authors.consensus(deps),
    (err) => err instanceof PhdudeError && /no author profiles/.test(err.message),
  );
});

test('list and show', async () => {
  const root = await newWorkspace();
  const deps = makeDeps(root);
  await authors.add(deps, PROFILE_FIELDS);

  const listed = await authors.list({ store: deps.store });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, 'researcher-a');

  const shown = await authors.show({ store: deps.store }, 'researcher-a');
  assert.equal(shown.id, 'researcher-a');

  await assert.rejects(
    () => authors.show({ store: deps.store }, 'nope'),
    (err) => err instanceof PhdudeError && /not found/.test(err.message),
  );
});

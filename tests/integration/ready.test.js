import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { renderReady } from '../../src/adapters/cli/output.js';
import { addEntity } from '../../src/application/add.js';
import { newEvidence } from '../../src/domain/entities.js';
import { check } from '../../src/application/ready.js';
import { submit } from '../../src/application/review.js';
import { PhdudeError } from '../../src/domain/errors.js';
import { CURRENT_WORKSPACE_VERSION } from '../../src/domain/versioning.js';

const actor = { researcher: 'test', agent: 'node' };
const NOW = () => '2026-09-07T12:00:00Z';

// One venue, resolved the way the CLI resolves it (adapters/packs/loader.js) without reaching
// for the packs on disk: `ready` only ever sees a profile the loader validated.
const VENUE = {
  name: 'test-venue',
  display: 'Test venue',
  document_class: 'article',
  citation_style: null,
  sections: [
    { id: 'introduction', order: 1 },
    { id: 'results', order: 2 },
  ],
};

function makeDeps(root, { profiles = { 'test-venue': VENUE } } = {}) {
  return {
    store: new FsStore(root),
    clock: NOW,
    actor,
    loadProfile: async (name) => profiles[name] ?? null,
  };
}

async function newRoot({ policy = null, workspaceVersion = CURRENT_WORKSPACE_VERSION } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-ready-'));
  await mkdir(join(root, '.phdude'), { recursive: true });
  await writeFile(
    join(root, 'phdude.yaml'),
    [
      'schema: phdude.project',
      'version: 1',
      `workspace_version: ${workspaceVersion}`,
      'title: Ready test',
      'language: en',
      'fields: []',
      'methods: []',
      'outputs: [thesis]',
      'mode: full',
      'agents: [claude-code]',
    ].join('\n') + '\n',
  );
  await writeFile(
    join(root, '.phdude', 'research-policy.yaml'),
    policy === null ? 'network:\n  enabled: false\n' : policy,
  );
  return root;
}

// A manuscript whose sections are all approved, and the prose behind them, so a test about one
// requirement is not also a test about the manuscript.
async function writeManuscript(store, { sections = [['introduction', 'approved']] } = {}) {
  await store.writeManuscript({
    schema: 'phdude.manuscript',
    version: 1,
    title: 'Ready test',
    language: 'en',
    voice: { kind: 'author', author: 'researcher-a' },
    sections: sections.map(([id, status], index) => ({
      id,
      title: id,
      file: `manuscript/${id}.md`,
      order: index + 1,
      status,
      hash: null,
      claims: [],
      questions: [],
    })),
    target_profile: 'test-venue',
  });
  for (const [id, status] of sections) {
    if (status === 'planned') continue;
    await store.writeTextAtomic(`manuscript/${id}.md`, `---\nsection: ${id}\n---\n\nProse.\n`);
  }
}

async function listing(root) {
  const entries = await readdir(root, { recursive: true });
  return entries.sort();
}

test('ready: reports the verdict and every check it made', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await writeManuscript(deps.store);

  const report = await check(deps);

  assert.equal(report.at, '2026-09-07T12:00:00Z');
  assert.equal(report.mode, 'full');
  assert.equal(report.profile, 'test-venue');
  assert.ok(report.checks.length >= 9);
  for (const entry of report.checks) {
    assert.ok(entry.message.length > 0, `${entry.code} explains nothing`);
    assert.match(entry.command, /^phdude /);
  }
});

test('ready: writes nothing at all - no file, no event', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await writeManuscript(deps.store);
  await addEntity(deps, 'question', { text: 'Does it hold?' });

  const before = await listing(root);
  const events = (await deps.store.readEvents(100)).length;

  await check(deps);

  assert.deepEqual(await listing(root), before, 'ready left something on disk');
  assert.equal((await deps.store.readEvents(100)).length, events, 'ready recorded an event');
});

test('ready: the venue comes from the manuscript, and --profile overrides it', async () => {
  const root = await newRoot();
  const other = { ...VENUE, name: 'other-venue', display: 'Other venue' };
  const deps = makeDeps(root, { profiles: { 'test-venue': VENUE, 'other-venue': other } });
  await writeManuscript(deps.store);

  assert.equal((await check(deps)).profile, 'test-venue');
  assert.equal((await check(deps, { profile: 'other-venue' })).profile, 'other-venue');
});

test('ready: an unknown venue is a usage error, not a silent pass', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await writeManuscript(deps.store);

  await assert.rejects(
    () => check(deps, { profile: 'nope' }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'USAGE');
      assert.match(err.message, /unknown venue: nope/);
      return true;
    },
  );
});

test('ready: a workspace with no venue says so rather than passing quietly', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await deps.store.writeManuscript({
    schema: 'phdude.manuscript',
    version: 1,
    title: 'Ready test',
    language: 'en',
    voice: { kind: 'author', author: 'researcher-a' },
    sections: [
      {
        id: 'introduction',
        title: 'Introduction',
        file: 'manuscript/introduction.md',
        order: 1,
        status: 'approved',
        hash: null,
        claims: [],
        questions: [],
      },
    ],
  });

  const report = await check(deps);

  assert.equal(report.profile, null);
  assert.ok(
    report.warnings.some((warning) => warning.includes('no venue profile is targeted')),
    report.warnings.join('; '),
  );
});

test('ready: the venue blocks the verdict when the manuscript has none of its sections', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await writeManuscript(deps.store);

  const report = await check(deps);

  const item = report.blocking.find((entry) => entry.code === 'profile-section-missing');
  assert.ok(item, report.blocking.map((entry) => entry.code).join(', '));
  assert.match(item.message, /results/);
  assert.equal(item.command, 'phdude profile check --profile test-venue');
  assert.equal(report.ready, false);
});

test('ready: the offline cite findings block, and the auditor is never run', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await writeManuscript(deps.store, {
    sections: [
      ['introduction', 'approved'],
      ['results', 'approved'],
    ],
  });
  const source = await addEntity(deps, 'source', {
    title: 'A paper',
    authors: ['Ada Lovelace'],
    year: 2024,
    type: 'article',
  });
  await addEntity(deps, 'evidence', {
    source: source.obj.id,
    excerpt: 'It holds.',
    strength: 'strong',
  });

  const clean = await check(deps);
  assert.equal(
    clean.checks.find((entry) => entry.code === 'citations-clean').ok,
    true,
    'a well-formed registry reported a citation fault',
  );

  // An evidence item citing an id nothing recorded: `cite check`'s `evidence-missing-source`,
  // which the audit weighs as `block`. `phdude add` refuses to create one, so this is the shape
  // a workspace reaches when the source it cited was taken out from under it.
  await deps.store.writeEntity(
    newEvidence({
      source: 'SRC-0000000000',
      excerpt: 'It does not.',
      strength: 'weak',
      actor,
      created: NOW(),
    }),
  );

  const report = await check(deps);
  const item = report.blocking.find((entry) => entry.code === 'citations-clean');
  assert.ok(item, report.blocking.map((entry) => entry.code).join(', '));
  assert.equal(item.command, 'phdude audit citations');
  assert.equal(
    (await deps.store.readEvents(100)).filter((event) => event.op === 'audit').length,
    0,
    'ready ran the citation auditor',
  );
});

test('ready: an open citation review recorded by the auditor blocks', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await writeManuscript(deps.store, {
    sections: [
      ['introduction', 'approved'],
      ['results', 'approved'],
    ],
  });
  const findings = join(root, 'findings.json');
  await writeFile(
    findings,
    JSON.stringify({
      findings: [
        {
          target: 'project',
          severity: 'major',
          message: 'the DOI on SRC-1 resolves to another paper',
          evidence: [],
        },
      ],
    }),
  );
  const created = await submit(
    { ...deps, readText: (path) => readFile(path, 'utf8') },
    { file: findings, kind: 'citation' },
  );
  assert.equal(created.created.length, 1);

  const report = await check(deps);
  const item = report.blocking.find((entry) => entry.code === 'citations-clean');
  assert.ok(item, report.blocking.map((entry) => entry.code).join(', '));
  assert.match(item.message, new RegExp(created.created[0].id));
});

test('ready: the policy chooses the threshold and the requirements', async () => {
  const root = await newRoot({
    policy: ['ready:', '  min_health: 0', '  require:', '    - figures-alt', ''].join('\n'),
  });
  const deps = makeDeps(root);
  await writeManuscript(deps.store, {
    sections: [
      ['introduction', 'approved'],
      ['results', 'draft'],
    ],
  });

  const report = await check(deps);

  assert.equal(report.health.min, 0);
  const codes = report.checks.map((entry) => entry.code);
  assert.ok(codes.includes('figures-alt'));
  assert.ok(!codes.includes('all-sections-approved'), 'a dropped requirement still ran');
  // The results section is still a draft, and with the requirement dropped nothing says so.
  assert.deepEqual(report.blocking, []);
  assert.equal(report.ready, true);
});

test('ready: the mode comes from the workspace, and lite narrows the verdict', async () => {
  const root = await newRoot({ policy: 'ready:\n  min_health: 0\n' });
  const deps = makeDeps(root);
  await writeManuscript(deps.store, {
    sections: [
      ['introduction', 'approved'],
      ['results', 'approved'],
    ],
  });
  await addEntity(deps, 'question', { text: 'Unanswered?' });

  const full = await check(deps);
  assert.equal(full.mode, 'full');
  assert.ok(full.blocking.some((entry) => entry.code === 'gaps-high'));

  const project = await deps.store.readProject();
  await deps.store.writeProject({ ...project, mode: 'lite' });

  const lite = await check(deps);
  assert.equal(lite.mode, 'lite');
  assert.equal(lite.ready, true);
  assert.ok(
    lite.relaxed.some((entry) => entry.code === 'gaps-high'),
    'lite hid the gap instead of setting it aside',
  );
});

test('ready: reads a workspace that still needs migrating rather than refusing it', async () => {
  const root = await newRoot({ workspaceVersion: CURRENT_WORKSPACE_VERSION - 1 });
  const deps = makeDeps(root);
  await writeManuscript(deps.store);

  const report = await check(deps);
  assert.equal(typeof report.ready, 'boolean');
});

test('ready: the rendered report leads with the verdict and names a command per blocker', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await writeManuscript(deps.store, { sections: [['introduction', 'draft']] });

  const report = await check(deps);
  const text = renderReady(report);

  assert.match(text, /^Not ready to submit: \d+ blocking item\(s\)\n/);
  assert.match(text, /\nVenue: test-venue {3}Mode: full {3}Research Health: /);
  assert.match(text, /\n {2}- \[all-sections-approved\] .*introduction/);
  assert.match(text, /\n {4}Fix: phdude manuscript status\n/);
  assert.match(text, /\nPassed \(\d+\):\n/);
});

test('ready: a workspace with nothing in its way renders as ready', async () => {
  const root = await newRoot({ policy: 'ready:\n  min_health: 0\n' });
  const deps = makeDeps(root);
  await writeManuscript(deps.store, {
    sections: [
      ['introduction', 'approved'],
      ['results', 'approved'],
    ],
  });

  const report = await check(deps);

  assert.equal(report.ready, true);
  assert.match(renderReady(report), /^Ready to submit: nothing is blocking\n/);
});

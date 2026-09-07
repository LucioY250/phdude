import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'phdude.js');
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'docs');
const ACTOR = ['--actor', 'researcher=tester,agent=e2e'];

function phdude(cwd, args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr });
      },
    );
  });
}

async function run(cwd, args) {
  const result = await phdude(cwd, [...args, ...ACTOR]);
  assert.equal(result.code, 0, `phdude ${args.join(' ')} failed:\n${result.stderr}`);
  return result;
}

async function runJson(cwd, args) {
  const { stdout } = await run(cwd, [...args, '--json']);
  return JSON.parse(stdout);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test('e2e: init, ingest, add, decide, promote, status, next, doctor, mode', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  // init
  await run(ws, ['init', '--title', 'E2E thesis', '--agents', 'claude-code,codex', '--no-git']);
  for (const rel of [
    'phdude.yaml',
    'AGENTS.md',
    'CLAUDE.md',
    join('.claude', 'commands', 'phdude.md'),
    join('.phdude', 'constitution.yaml'),
    join('.phdude', 'skills', 'bootstrap', 'SKILL.md'),
    join('sources', '.gitkeep'),
  ]) {
    assert.ok(await exists(join(ws, rel)), `init should create ${rel}`);
  }
  assert.equal(await exists(join(ws, '.git')), false, '--no-git should skip git init');

  // ingest the fixture documents
  await cp(FIXTURES_DIR, join(ws, 'sources'), { recursive: true });
  const ingested = await runJson(ws, ['ingest']);
  assert.ok(ingested.artifacts.length >= 5, 'every fixture document is inventoried');

  const byKind = Object.fromEntries(ingested.artifacts.map((a) => [a.kind, a]));
  const mdArtifact = byKind.md;
  const txtArtifact = byKind.txt;
  assert.ok(mdArtifact && txtArtifact, 'the md and txt fixtures are inventoried');
  for (const a of ingested.artifacts) assert.equal(a.role, 'unknown');

  // knowledge entities: source -> evidence -> claim
  const source = await runJson(ws, [
    'add',
    'source',
    '--json',
    JSON.stringify({
      title: 'A study of things',
      authors: ['Ada Lovelace'],
      year: 2024,
      type: 'article',
      artifacts: [mdArtifact.id],
    }),
  ]);
  assert.match(source.id, /^SRC-[0-9a-f]{10}$/);

  const evidence = await runJson(ws, [
    'add',
    'evidence',
    '--json',
    JSON.stringify({
      source: source.id,
      locator: 'p. 4',
      excerpt: 'The intervention increased throughput.',
      strength: 'moderate',
    }),
  ]);
  assert.match(evidence.id, /^EVID-[0-9a-f]{10}$/);

  const claim = await runJson(ws, [
    'add',
    'claim',
    '--json',
    JSON.stringify({
      statement: 'The intervention increases throughput.',
      kind: 'empirical',
      supported_by: [evidence.id],
    }),
  ]);
  assert.equal(claim.state, 'candidate');

  // two artifacts report a different sample_size: a deterministic conflict
  await run(ws, [
    'add',
    'fact',
    '--json',
    JSON.stringify({
      key: 'sample_size',
      value: 142,
      from: { artifact: mdArtifact.id, locator: 'p. 12' },
    }),
  ]);
  await run(ws, [
    'add',
    'fact',
    '--json',
    JSON.stringify({
      key: 'sample_size',
      value: 118,
      from: { artifact: txtArtifact.id, locator: 'p. 3' },
    }),
  ]);

  const status = await runJson(ws, ['status']);
  assert.equal(status.conflicts.length, 1);
  assert.equal(status.conflicts[0].key, 'sample_size');
  assert.equal(status.conflicts[0].resolved, null);
  assert.equal(status.project.title, 'E2E thesis');
  assert.equal(status.knowledge.byType.claim.total, 1);

  // the claim cannot become canonical without an approved decision
  const decision = await runJson(ws, [
    'decide',
    'propose',
    '--title',
    'Promote the throughput claim',
    '--rationale',
    'Reviewed by the researcher.',
    '--affects',
    claim.id,
    '--change',
    '{}',
  ]);
  assert.match(decision.id, /^DEC-[0-9a-f]{10}$/);
  assert.equal(decision.status, 'proposed');

  const denied = await phdude(ws, ['promote', claim.id, '--decision', decision.id, ...ACTOR]);
  assert.equal(denied.code, 3, 'promoting on an unapproved decision is a policy violation');
  assert.match(denied.stderr, /not approved/);
  assert.match(denied.stderr, /Suggested action:/);

  await run(ws, ['decide', 'approve', decision.id, '--by', 'tester']);
  const promoted = await runJson(ws, ['promote', claim.id, '--decision', decision.id]);
  assert.equal(promoted.state, 'canonical');

  // knowledge queries
  const claims = await runJson(ws, ['knowledge', 'list', '--type', 'claim']);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].id, claim.id);

  const shown = await runJson(ws, ['knowledge', 'show', claim.id]);
  assert.equal(shown.state, 'canonical');

  const traced = await runJson(ws, ['knowledge', 'trace', claim.id]);
  assert.ok(
    traced.up.some((o) => o.id === evidence.id),
    'the claim traces up to its evidence',
  );

  // next always explains itself
  const next = await runJson(ws, ['next']);
  assert.ok(next.top, 'next returns a top action');
  assert.ok(next.top.why.length > 0, 'the top action explains why');
  assert.ok(next.actions.length >= 1);

  // doctor
  const doctor = await runJson(ws, ['doctor']);
  assert.equal(doctor.workspace, true);
  assert.equal(typeof doctor.node, 'string');
  assert.equal(typeof doctor.pdftotext, 'boolean');
  assert.equal(typeof doctor.git, 'boolean');
  assert.equal(doctor.schemaVersions.claim, 1);
  assert.ok(doctor.cacheEntries >= 1);
  assert.ok(doctor.packsAvailable.includes('quantitative'));

  // mode persists to phdude.yaml
  await run(ws, ['mode', 'ruthless']);
  const afterMode = await runJson(ws, ['status']);
  assert.equal(afterMode.project.mode, 'ruthless');
  assert.ok(
    afterMode.recentEvents.some((e) => e.op === 'mode'),
    'setting the mode is recorded in the event log',
  );

  // an unknown command is a usage error
  const unknown = await phdude(ws, ['frobnicate']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Usage/);
});

test('e2e: bootstrap ingests, detects packs and prints the agent handoff', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-boot-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Bootstrap thesis', '--no-git']);
  await cp(FIXTURES_DIR, join(ws, 'sources'), { recursive: true });

  const result = await runJson(ws, ['bootstrap']);
  assert.ok(result.ingest.artifacts.length >= 5);
  assert.ok(Array.isArray(result.packs.recommended));
  assert.ok(result.status.inventory.total >= 5);
  assert.ok(result.next.top.why.length > 0);
  assert.match(result.handoff, /phdude add/);

  // bootstrap is re-runnable; the second pass ingests nothing new but still hands off
  const { stdout } = await run(ws, ['bootstrap']);
  assert.match(stdout, /Agent handoff/);
  assert.match(stdout, /\.phdude\/skills\/bootstrap\/SKILL\.md/);
  assert.match(stdout, /Highest-impact next action/);
});

test('e2e: --help and --version exit 0, a bare invocation is a usage error', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-help-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  const help = await phdude(ws, ['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /init \[dir\]/);

  const helpCommand = await phdude(ws, ['help']);
  assert.equal(helpCommand.code, 0);
  assert.match(helpCommand.stdout, /the highest-impact next action/);

  const version = await phdude(ws, ['--version']);
  assert.equal(version.code, 0);
  assert.match(version.stdout, /^phdude \d+\.\d+\.\d+/);

  const bare = await phdude(ws, []);
  assert.equal(bare.code, 1);
  assert.match(bare.stderr, /Usage/);
});

test('e2e: errors are typed, and --json reports them as structured output', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-err-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Error thesis', '--no-git']);

  const missing = await phdude(ws, ['knowledge', 'show', 'CLAIM-0000000000', '--json', ...ACTOR]);
  assert.equal(missing.code, 1);
  const payload = JSON.parse(missing.stderr);
  assert.equal(payload.error.code, 'USAGE');
  assert.match(payload.error.message, /not found/);

  const badPack = await phdude(ws, ['packs', 'apply', 'no-such-pack', ...ACTOR]);
  assert.equal(badPack.code, 1);
  assert.match(badPack.stderr, /unknown pack/);

  const badJson = await phdude(ws, ['add', 'claim', '--json', '{not json', ...ACTOR]);
  assert.equal(badJson.code, 2);
  assert.match(badJson.stderr, /JSON/);
});

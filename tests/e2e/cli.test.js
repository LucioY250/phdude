import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'phdude.js');
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'docs');
const V01_WORKSPACE = join(REPO_ROOT, 'tests', 'fixtures', 'workspaces', 'v0.1-minimal');
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

  assert.equal(ingested.inventory.length, 7, 'the inventory lists the whole workspace');

  // Re-ingesting changes nothing, but the inventory still lists every artifact, which is
  // what an agent re-running bootstrap needs to work from.
  const reingested = await runJson(ws, ['ingest']);
  assert.equal(reingested.artifacts.length, 0, 'nothing changed on the second pass');
  assert.equal(reingested.skipped.length, 7);
  assert.equal(reingested.inventory.length, 7);
  const inventoryIds = reingested.inventory.map((a) => a.id);
  assert.deepEqual(inventoryIds, [...inventoryIds].sort(), 'the inventory is sorted by id');
  for (const entry of reingested.inventory) {
    assert.deepEqual(Object.keys(entry).sort(), ['extracted', 'id', 'kind', 'path', 'role']);
    assert.equal(entry.role, 'unknown');
    assert.equal(typeof entry.extracted.status, 'string');
  }

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

  // --file resolves against the working directory and returns the text confirmation,
  // because it does not set the --json output flag the way an inline payload does
  await writeFile(
    join(ws, 'study-period.json'),
    JSON.stringify({
      key: 'study_period',
      value: '2024-2025',
      from: { artifact: mdArtifact.id },
    }),
  );
  const viaFile = await run(ws, ['add', 'fact', '--file', 'study-period.json']);
  assert.match(viaFile.stdout, /^Added FACT-[0-9a-f]{10} \(candidate\)$/m);

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
  const bootstrapSkill = doctor.skills.find((s) => s.name === 'bootstrap');
  assert.ok(bootstrapSkill, 'doctor lists the bootstrap skill');
  assert.equal(bootstrapSkill.source, 'workspace');
  assert.deepEqual(bootstrapSkill.permissions, { network: 'none', workspace: ['read'] });
  assert.deepEqual(bootstrapSkill.warnings, []);

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

test('e2e: link attaches evidence that add cannot, and next stops asking for it', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-link-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Link thesis', '--no-git']);
  await cp(FIXTURES_DIR, join(ws, 'sources'), { recursive: true });
  const ingested = await runJson(ws, ['ingest']);
  const artifact = ingested.artifacts.find((a) => a.kind === 'md');

  const source = await runJson(ws, [
    'add',
    'source',
    '--json',
    JSON.stringify({ title: 'A linkable study', artifacts: [artifact.id] }),
  ]);
  const evidence = await runJson(ws, [
    'add',
    'evidence',
    '--json',
    JSON.stringify({ source: source.id, locator: 'p. 2', excerpt: 'Throughput rose by 14%.' }),
  ]);
  const claim = await runJson(ws, [
    'add',
    'claim',
    '--json',
    JSON.stringify({ statement: 'Throughput rose after the intervention.' }),
  ]);
  await run(ws, ['promote', claim.id, '--to', 'supported']);

  // A supported claim with no evidence is exactly what next rule 5 is for.
  const before = await runJson(ws, ['next']);
  assert.equal(before.top.rule, 'unsupported-claims');
  assert.equal(before.top.command, `phdude link ${claim.id} --to <EVID-id>`);

  const linked = await runJson(ws, ['link', claim.id, '--to', evidence.id]);
  assert.deepEqual(linked.supported_by, [evidence.id]);

  // `--to` is variadic only for link, so promote still accepts the flag before the id.
  const flagFirst = await runJson(ws, ['promote', '--to', 'candidate', claim.id]);
  assert.equal(flagFirst.state, 'candidate');
  await run(ws, ['promote', claim.id, '--to', 'supported']);

  const after = await runJson(ws, ['next']);
  assert.ok(
    !after.actions.some((a) => a.rule === 'unsupported-claims'),
    'the claim is no longer unsupported',
  );

  const events = await runJson(ws, ['status']);
  assert.ok(events.recentEvents.some((e) => e.op === 'link'));

  // Re-running the same link changes nothing and is not an error.
  const again = await run(ws, ['link', claim.id, '--to', evidence.id]);
  assert.match(again.stdout, /already links to every target/);

  // Linking to an object of the wrong type is a validation error.
  const wrongType = await phdude(ws, ['link', claim.id, '--to', source.id, ...ACTOR]);
  assert.equal(wrongType.code, 2);
  assert.match(wrongType.stderr, /cannot link/);
});

test('e2e: usage errors honour --json too', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-usage-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  const unknown = await phdude(ws, ['frobnicate', '--json']);
  assert.equal(unknown.code, 1);
  assert.equal(unknown.stdout, '', 'stdout stays empty on error');
  const unknownError = JSON.parse(unknown.stderr).error;
  assert.equal(unknownError.code, 'USAGE');
  assert.match(unknownError.message, /unknown command/);
  assert.equal(unknownError.hint, 'run phdude help');

  const bare = await phdude(ws, ['--json']);
  assert.equal(bare.code, 1);
  assert.equal(bare.stdout, '');
  assert.equal(JSON.parse(bare.stderr).error.code, 'USAGE');
});

test('e2e: bootstrap outside a workspace points at init', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-noboot-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  const result = await phdude(ws, ['bootstrap', ...ACTOR]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not a PhDude workspace/);
  assert.match(result.stderr, /Suggested action: run phdude init/);
});

test('e2e: bootstrap ingests, detects packs and prints the agent handoff', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-boot-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Bootstrap thesis', '--no-git']);
  await cp(FIXTURES_DIR, join(ws, 'sources'), { recursive: true });

  const result = await runJson(ws, ['bootstrap']);
  assert.ok(result.ingest.artifacts.length >= 5);
  assert.equal(result.ingest.inventory.length, 7);
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

test('e2e: a malformed entity file makes status exit 2 and names the file', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-malformed-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Malformed thesis', '--no-git']);
  await writeFile(join(ws, 'knowledge', 'facts', 'FACT-0123456789.yaml'), '');

  const result = await phdude(ws, ['status', ...ACTOR]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /malformed entity file: knowledge\/facts\/FACT-0123456789\.yaml/);
  assert.match(result.stderr, /Suggested action: fix or delete the file/);

  // A git merge conflict is the realistic trigger, and it makes the YAML unparseable rather
  // than empty; it must be named the same way instead of escaping as an internal error.
  await writeFile(
    join(ws, 'knowledge', 'facts', 'FACT-0123456789.yaml'),
    '<<<<<<< HEAD\nvalue: 142\n=======\nvalue: 151\n>>>>>>> theirs\n',
  );
  const conflicted = await phdude(ws, ['status', '--json', ...ACTOR]);
  assert.equal(conflicted.code, 2);
  const payload = JSON.parse(conflicted.stderr).error;
  assert.equal(payload.code, 'VALIDATION');
  assert.equal(payload.message, 'malformed entity file: knowledge/facts/FACT-0123456789.yaml');
  assert.equal(payload.hint, 'fix or delete the file');
});

test('e2e: packs outside a workspace point at init instead of crashing', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-nopacks-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  for (const args of [
    ['packs', 'list'],
    ['packs', 'detect'],
    ['packs', 'apply', 'quantitative'],
  ]) {
    const result = await phdude(ws, [...args, ...ACTOR]);
    assert.equal(result.code, 1, `${args.join(' ')} should be a usage error`);
    assert.match(result.stderr, /not a PhDude workspace/);
    assert.match(result.stderr, /Suggested action: run phdude init/);
  }
});

test('e2e: ingest refuses a path outside the workspace', async (t) => {
  const outside = await mkdtemp(join(tmpdir(), 'phdude-e2e-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'secret.txt'), 'SECRET_TOKEN=abc123\n');

  const ws = join(outside, 'ws');
  await run(outside, ['init', 'ws', '--title', 'Contained thesis', '--no-git']);

  const result = await phdude(ws, ['ingest', '../secret.txt', ...ACTOR]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /path is outside the workspace: \.\.\/secret\.txt/);
  assert.match(result.stderr, /Suggested action: copy the files into sources\/ first/);

  const listed = await runJson(ws, ['knowledge', 'list', '--type', 'artifact']);
  assert.equal(listed.length, 0, 'nothing outside the workspace was recorded');
});

test('e2e: an unknown field on add is a validation error, not a silent drop', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-field-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Field thesis', '--no-git']);
  const result = await phdude(ws, [
    'add',
    'claim',
    '--json',
    JSON.stringify({ statement: 'A typo-linked claim.', question: ['RQ-1'] }),
    ...ACTOR,
  ]);
  assert.equal(result.code, 2);
  const payload = JSON.parse(result.stderr).error;
  assert.equal(payload.code, 'VALIDATION');
  assert.equal(payload.message, 'unknown field(s) for claim: question');
  assert.match(payload.hint, /questions/);
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

  const noBy = await phdude(ws, ['decide', 'approve', 'DEC-0123456789', ...ACTOR]);
  assert.equal(noBy.code, 1);
  assert.match(noBy.stderr, /"--by <researcher>" is required/);
  assert.match(noBy.stderr, /Suggested action: phdude decide approve <DEC-id> --by <your-name>/);

  const badJson = await phdude(ws, ['add', 'claim', '--json', '{not json', ...ACTOR]);
  assert.equal(badJson.code, 2);
  assert.match(badJson.stderr, /JSON/);
});

test('e2e: migrate upgrades a committed v0.1 workspace', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-migrate-'));
  t.after(() => rm(ws, { recursive: true, force: true }));
  await cp(V01_WORKSPACE, ws, { recursive: true });

  // Reads work on a v0.1 workspace and say what is wrong with it.
  const before = await runJson(ws, ['status']);
  assert.equal(before.knowledge.byType.claim.total, 1);
  assert.ok(before.warnings.includes('workspace needs migration (1 → 2)'));

  // Writes do not, and they name the command that fixes it.
  const refused = await phdude(ws, [
    'add',
    'claim',
    '--json',
    JSON.stringify({ statement: 'A claim written before the migration.' }),
    ...ACTOR,
  ]);
  assert.equal(refused.code, 1);
  const refusal = JSON.parse(refused.stderr).error;
  assert.equal(refusal.code, 'USAGE');
  assert.equal(refusal.message, 'workspace needs migration (1 → 2)');
  assert.equal(refusal.hint, 'run phdude migrate');

  const dryRun = await runJson(ws, ['migrate', '--dry-run']);
  assert.equal(dryRun.applied, false);
  assert.equal(dryRun.from, 1);
  assert.ok(dryRun.steps[0].changed.includes('phdude.yaml'));
  const stillBehind = await runJson(ws, ['status']);
  assert.ok(
    stillBehind.warnings.includes('workspace needs migration (1 → 2)'),
    'a dry run writes nothing',
  );

  const applied = await run(ws, ['migrate']);
  assert.match(applied.stdout, /Migrated workspace 1 → 2/);

  const after = await runJson(ws, ['status']);
  assert.deepEqual(after.warnings, []);
  assert.ok(after.recentEvents.some((e) => e.op === 'migrate'));

  const doctor = await runJson(ws, ['doctor']);
  assert.equal(doctor.workspaceVersion, 2);

  // The write that was refused now goes through.
  await run(ws, [
    'add',
    'claim',
    '--json',
    JSON.stringify({ statement: 'A claim written after the migration.' }),
  ]);

  const second = await run(ws, ['migrate']);
  assert.match(second.stdout, /Workspace is up to date \(2\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, cp, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'phdude.js');
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'docs');
const V01_WORKSPACE = join(REPO_ROOT, 'tests', 'fixtures', 'workspaces', 'v0.1-minimal');
const ACTOR = ['--actor', 'researcher=tester,agent=e2e'];

function phdude(cwd, args, env) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd, maxBuffer: 32 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env },
      (err, stdout, stderr) => {
        resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr });
      },
    );
  });
}

async function run(cwd, args, env) {
  const result = await phdude(cwd, [...args, ...ACTOR], env);
  assert.equal(result.code, 0, `phdude ${args.join(' ')} failed:\n${result.stderr}`);
  return result;
}

async function runJson(cwd, args, env) {
  const { stdout } = await run(cwd, [...args, '--json'], env);
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
  assert.equal(doctor.network, false, 'a fresh workspace keeps the network closed');
  assert.deepEqual(doctor.providers, ['openalex', 'crossref', 'arxiv']);
  const doctorText = await run(ws, ['doctor']);
  assert.match(doctorText.stdout, /network: +disabled/);
  assert.match(doctorText.stdout, /providers: +openalex, crossref, arxiv/);
  assert.ok(doctor.cacheEntries >= 1);
  assert.ok(doctor.packsAvailable.includes('quantitative'));
  const bootstrapSkill = doctor.skills.find((s) => s.name === 'bootstrap');
  assert.ok(bootstrapSkill, 'doctor lists the bootstrap skill');
  // `init` copied it into .phdude/skills/, but the bytes are the shipped ones, so it is still
  // the core skill; only an edited copy is the workspace's own.
  assert.equal(bootstrapSkill.source, 'core');
  assert.deepEqual(bootstrapSkill.permissions, { network: 'none', workspace: ['read'] });
  assert.deepEqual(bootstrapSkill.warnings, []);

  await appendFile(join(ws, '.phdude', 'skills', 'bootstrap', 'SKILL.md'), '\nlocal note\n');
  const doctorEdited = await runJson(ws, ['doctor']);
  assert.equal(doctorEdited.skills.find((s) => s.name === 'bootstrap').source, 'workspace');

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

test('e2e: a malformed research policy is typed, and doctor says so instead of guessing', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-badpolicy-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Broken policy', '--no-git']);
  // The README sends every researcher to hand-edit this file, so a two-line syntax error in it
  // is an ordinary accident rather than an exotic one.
  await writeFile(
    join(ws, '.phdude', 'research-policy.yaml'),
    'network:\n  enabled: true\n  providers\n',
  );

  for (const command of [
    ['status'],
    ['gaps'],
    ['next'],
    ['freshness'],
    ['cite', 'check'],
    ['research', 'open science'],
  ]) {
    const result = await phdude(ws, [...command, '--json', ...ACTOR]);
    assert.equal(result.code, 2, `phdude ${command.join(' ')} should exit 2`);
    const payload = JSON.parse(result.stderr).error;
    assert.equal(payload.code, 'VALIDATION');
    assert.equal(payload.message, 'malformed YAML: .phdude/research-policy.yaml');
    assert.equal(payload.hint, 'fix the file');
  }

  // doctor is the command you run when something is off, so it survives - but it must not
  // present the built-in defaults as though they were this workspace's policy.
  const report = await phdude(ws, ['doctor', ...ACTOR]);
  assert.equal(report.code, 0);
  assert.match(
    report.stdout,
    /policy: +unreadable \(malformed YAML: \.phdude\/research-policy\.yaml\)/,
  );
  assert.doesNotMatch(report.stdout, /^providers:/m);
  assert.doesNotMatch(report.stdout, /^network:/m);

  const json = JSON.parse((await phdude(ws, ['doctor', '--json', ...ACTOR])).stdout);
  assert.equal(json.policyError, 'malformed YAML: .phdude/research-policy.yaml');
  assert.equal(json.network, null);
  assert.deepEqual(json.providers, []);
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
  assert.ok(before.warnings.includes('workspace needs migration (1 → 3)'));

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
  assert.equal(refusal.message, 'workspace needs migration (1 → 3)');
  assert.equal(refusal.hint, 'run phdude migrate');

  const dryRun = await runJson(ws, ['migrate', '--dry-run']);
  assert.equal(dryRun.applied, false);
  assert.equal(dryRun.from, 1);
  assert.ok(dryRun.steps[0].changed.includes('phdude.yaml'));
  const stillBehind = await runJson(ws, ['status']);
  assert.ok(
    stillBehind.warnings.includes('workspace needs migration (1 → 3)'),
    'a dry run writes nothing',
  );

  const applied = await run(ws, ['migrate']);
  assert.match(applied.stdout, /Migrated workspace 1 → 3/);

  const after = await runJson(ws, ['status']);
  assert.deepEqual(after.warnings, []);
  assert.ok(after.recentEvents.some((e) => e.op === 'migrate'));

  const doctor = await runJson(ws, ['doctor']);
  assert.equal(doctor.workspaceVersion, 3);

  // The write that was refused now goes through.
  await run(ws, [
    'add',
    'claim',
    '--json',
    JSON.stringify({ statement: 'A claim written after the migration.' }),
  ]);

  const second = await run(ws, ['migrate']);
  assert.match(second.stdout, /Workspace is up to date \(3\)/);
});

test('e2e: add artifact-role reports the update in text mode', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-role-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Role thesis', '--no-git']);
  await cp(FIXTURES_DIR, join(ws, 'sources'), { recursive: true });
  const ingested = await runJson(ws, ['ingest']);
  const artifact = ingested.artifacts.find((a) => a.kind === 'md');

  // --file, not --json: `--json '<obj>'` also turns on JSON output, so the text verb below is
  // only ever seen through the file form.
  const payload = join(ws, 'role.json');
  await writeFile(payload, JSON.stringify({ id: artifact.id, role: 'paper' }));

  const updated = await run(ws, ['add', 'artifact-role', '--file', payload]);
  assert.equal(updated.stdout, `Updated ${artifact.id} role → paper\n`);

  const unchanged = await run(ws, ['add', 'artifact-role', '--file', payload]);
  assert.equal(unchanged.stdout, `Unchanged ${artifact.id}\n`);
});

test('e2e: a workspace newer than this phdude refuses writes and doctor says so', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-newer-'));
  t.after(() => rm(ws, { recursive: true, force: true }));
  await run(ws, ['init', '--title', 'From the future', '--no-git']);

  const config = join(ws, 'phdude.yaml');
  await writeFile(
    config,
    (await readFile(config, 'utf8')).replace('workspace_version: 3', 'workspace_version: 4'),
  );

  const message = 'workspace version 4 is newer than this PhDude (3)';

  // Reads keep working and say what is wrong, the same way an older workspace does.
  const read = await runJson(ws, ['status']);
  assert.ok(read.warnings.includes(message));

  const refused = await phdude(ws, [
    'add',
    'claim',
    '--json',
    JSON.stringify({ statement: 'Written by a build that is behind.' }),
    ...ACTOR,
  ]);
  assert.equal(refused.code, 1);
  const refusal = JSON.parse(refused.stderr).error;
  assert.equal(refusal.code, 'USAGE');
  assert.equal(refusal.message, message);
  assert.equal(refusal.hint, 'upgrade phdude');

  const report = await runJson(ws, ['doctor']);
  assert.equal(report.workspaceVersion, 4);
  assert.ok(report.warnings.includes(message));

  const text = await run(ws, ['doctor']);
  assert.match(text.stdout, /workspace version: 4 \(newer than this phdude\)/);
});

test('e2e: methods, provenance and the trace line that reports them', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-method-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Method thesis', '--no-git']);
  assert.ok(await exists(join(ws, 'research', 'methods')), 'init creates research/methods');

  await cp(FIXTURES_DIR, join(ws, 'sources'), { recursive: true });
  const ingested = await runJson(ws, ['ingest']);
  const artifact = ingested.artifacts.find((a) => a.kind === 'md');

  const question = await runJson(ws, [
    'add',
    'question',
    '--json',
    JSON.stringify({ text: 'Does adoption differ across campuses?' }),
  ]);

  const method = await runJson(ws, [
    'add',
    'method',
    '--json',
    JSON.stringify({
      name: 'Cross-sectional survey',
      design: 'One wave across three campuses.',
      paradigm: 'quantitative',
      sampling: 'stratified random sample',
      instruments: ['adoption questionnaire v2'],
      analysis: ['descriptive statistics'],
      limitations: ['single country'],
    }),
  ]);
  assert.match(method.id, /^METH-[0-9a-f]{10}$/);
  assert.equal(method.state, 'candidate');
  assert.ok(await exists(join(ws, 'research', 'methods', `${method.id}.yaml`)));

  const linked = await runJson(ws, ['link', method.id, '--to', question.id]);
  assert.deepEqual(linked.questions, [question.id]);

  const methods = await runJson(ws, ['knowledge', 'list', '--type', 'method']);
  assert.deepEqual(
    methods.map((m) => m.id),
    [method.id],
  );

  const status = await runJson(ws, ['status']);
  assert.equal(status.knowledge.byType.method.total, 1);
  const statusText = await run(ws, ['status']);
  assert.match(statusText.stdout, /method: total=1 \(candidate=1\)/);

  // Provenance: an agent-run add records agent-extraction and the artifacts behind it.
  const source = await runJson(ws, [
    'add',
    'source',
    '--json',
    JSON.stringify({ title: 'A study of adoption', artifacts: [artifact.id] }),
  ]);
  const evidence = await runJson(ws, [
    'add',
    'evidence',
    '--json',
    JSON.stringify({ source: source.id, locator: 'p. 2', excerpt: 'Adoption rose by 14%.' }),
  ]);
  assert.deepEqual(evidence.provenance, {
    method: 'agent-extraction',
    derived_from: [artifact.id],
  });

  const claim = await runJson(ws, [
    'add',
    'claim',
    '--json',
    JSON.stringify({
      statement: 'Adoption rose after the intervention.',
      supported_by: [evidence.id],
    }),
  ]);
  assert.deepEqual(claim.provenance, { method: 'agent-extraction', derived_from: [artifact.id] });

  const traced = await run(ws, ['knowledge', 'trace', claim.id]);
  assert.match(traced.stdout, new RegExp(`provenance: agent-extraction ← ${artifact.id}`));

  // A researcher typing at the CLI records manual provenance instead.
  const typed = await phdude(ws, [
    'add',
    'claim',
    '--json',
    JSON.stringify({ statement: 'A claim the researcher typed.' }),
    '--actor',
    'researcher=tester,agent=cli',
  ]);
  assert.equal(typed.code, 0);
  assert.equal(JSON.parse(typed.stdout).provenance.method, 'manual');
});

test('e2e: an unknown flag exits 1 and lists the flags the command accepts', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-strict-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Strict thesis', '--no-git']);

  const typo = await phdude(ws, ['knowledge', 'list', '--typo', 'x', ...ACTOR]);
  assert.equal(typo.code, 1);
  assert.match(typo.stderr, /unknown option --typo for knowledge/);
  assert.match(typo.stderr, /Suggested action: allowed: .*--query/);

  const wrongCommand = await phdude(ws, ['status', '--rationale', 'x', '--json', ...ACTOR]);
  assert.equal(wrongCommand.code, 1);
  const payload = JSON.parse(wrongCommand.stderr).error;
  assert.equal(payload.code, 'USAGE');
  assert.equal(payload.message, 'unknown option --rationale for status');

  // The flags each command does document keep working.
  await run(ws, ['knowledge', 'list', '--type', 'claim', '--state', 'candidate', '--query', 'x']);
});

test('e2e: supersede names the researcher and the superseding decision', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-supersede-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Supersede thesis', '--no-git']);

  const original = await runJson(ws, [
    'decide',
    'propose',
    '--title',
    'Adopt 312 as the canonical sample size',
    '--rationale',
    'Two surveys agree.',
  ]);
  const replacement = await runJson(ws, [
    'decide',
    'propose',
    '--title',
    'Adopt 300 as the canonical sample size',
    '--rationale',
    'The third survey corrects the count.',
  ]);

  const oldForm = await phdude(ws, [
    'decide',
    'supersede',
    original.id,
    '--by',
    replacement.id,
    ...ACTOR,
  ]);
  assert.equal(oldForm.code, 1);
  assert.match(oldForm.stderr, /--by is the researcher; pass the superseding decision with --with/);

  const superseded = await runJson(ws, [
    'decide',
    'supersede',
    original.id,
    '--by',
    'Ada Lovelace',
    '--with',
    replacement.id,
  ]);
  assert.equal(superseded.status, 'superseded');
  assert.equal(superseded.change.superseded_by, replacement.id);
});

test('e2e: ingest . walks sources/ only and refuses a path into the knowledge base', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-scope-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Scoped thesis', '--no-git']);
  await cp(FIXTURES_DIR, join(ws, 'sources'), { recursive: true });
  await writeFile(join(ws, 'manuscript', 'chapter-1.md'), '# Chapter 1\n\nDraft prose.\n');

  const ingested = await runJson(ws, ['ingest', '.']);
  assert.ok(ingested.artifacts.length > 0);
  for (const a of ingested.inventory) {
    assert.ok(a.path.startsWith('sources/'), `${a.path} is not under sources/`);
  }

  const refused = await phdude(ws, ['ingest', 'knowledge', ...ACTOR]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /not a source path: knowledge/);
  assert.match(refused.stderr, /Suggested action: put research materials under sources\//);
});

test('e2e: link --contradicts disputes both claims and promote requires a resolving decision', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-contradicts-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Contradicts thesis', '--no-git']);

  const claimA = await runJson(ws, [
    'add',
    'claim',
    '--json',
    JSON.stringify({ statement: 'The effect of the intervention is positive.' }),
  ]);
  const claimB = await runJson(ws, [
    'add',
    'claim',
    '--json',
    JSON.stringify({ statement: 'The effect of the intervention is negative.' }),
  ]);

  const linked = await runJson(ws, ['link', claimA.id, '--contradicts', claimB.id]);
  assert.equal(linked.linked, true);
  assert.equal(linked.a.state, 'disputed');
  assert.equal(linked.b.state, 'disputed');

  const status = await runJson(ws, ['status']);
  const pair = [claimA.id, claimB.id].sort();
  assert.deepEqual(status.disputedPairs, [pair]);

  const statusText = await run(ws, ['status']);
  assert.match(statusText.stdout, /Disputed claims \(1 pair\):/);
  assert.match(statusText.stdout, new RegExp(`${pair[0]} ⟷ ${pair[1]}`));

  // `--to` and `--contradicts` are mutually exclusive.
  const conflictingFlags = await phdude(ws, [
    'link',
    claimA.id,
    '--to',
    claimB.id,
    '--contradicts',
    claimB.id,
    ...ACTOR,
  ]);
  assert.equal(conflictingFlags.code, 1);
  assert.match(conflictingFlags.stderr, /mutually exclusive/);

  // A claim cannot contradict itself.
  const selfLink = await phdude(ws, ['link', claimA.id, '--contradicts', claimA.id, ...ACTOR]);
  assert.equal(selfLink.code, 1);
  assert.match(selfLink.stderr, /cannot contradict itself/);

  // Re-running the same contradiction changes nothing and is not an error.
  const again = await runJson(ws, ['link', claimA.id, '--contradicts', claimB.id]);
  assert.equal(again.linked, false);

  // Promoting a disputed claim out to supported without a resolving decision is blocked.
  const blocked = await phdude(ws, ['promote', claimA.id, '--to', 'supported', ...ACTOR]);
  assert.equal(blocked.code, 3);
  assert.match(blocked.stderr, /resolves_contradiction/);

  const decision = await runJson(ws, [
    'decide',
    'propose',
    '--title',
    'Resolve the effect-direction contradiction',
    '--rationale',
    'The negative-effect claim relied on a flawed measure.',
    '--affects',
    claimA.id,
    claimB.id,
    '--change',
    JSON.stringify({ resolves_contradiction: [claimA.id, claimB.id], survivor: claimA.id }),
  ]);
  await run(ws, ['decide', 'approve', decision.id, '--by', 'Ada Lovelace']);

  // A single decision does not rehabilitate both sides: the survivor cannot be promoted while
  // the loser it names is still disputed, and the decision refuses to promote the loser at all.
  const survivorBlocked = await phdude(ws, [
    'promote',
    claimA.id,
    '--to',
    'supported',
    '--decision',
    decision.id,
    ...ACTOR,
  ]);
  assert.equal(survivorBlocked.code, 3);
  assert.match(survivorBlocked.stderr, /rejected first/);

  const loserBlocked = await phdude(ws, [
    'promote',
    claimB.id,
    '--to',
    'supported',
    '--decision',
    decision.id,
    ...ACTOR,
  ]);
  assert.equal(loserBlocked.code, 3);
  assert.match(loserBlocked.stderr, new RegExp(`names ${claimA.id} as the survivor`));

  await run(ws, ['promote', claimB.id, '--to', 'rejected']);

  const promoted = await runJson(ws, [
    'promote',
    claimA.id,
    '--to',
    'supported',
    '--decision',
    decision.id,
  ]);
  assert.equal(promoted.state, 'supported');

  const finalStatus = await runJson(ws, ['status']);
  assert.deepEqual(finalStatus.disputedPairs, []);
});

test('e2e: cite check exits 2 while a source is broken, then 0 once it is fixed', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-cite-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Cite thesis', '--no-git']);

  const broken = await runJson(ws, [
    'add',
    'source',
    '--json',
    JSON.stringify({
      title: 'A Study With A Bad DOI',
      authors: ['A. One'],
      year: 2024,
      doi: 'not-a-doi',
    }),
  ]);

  const failing = await phdude(ws, ['cite', 'check', ...ACTOR]);
  assert.equal(failing.code, 2, 'an invalid DOI fails the check');
  assert.match(failing.stdout, /FAILED/);
  assert.match(failing.stdout, /invalid-doi/);
  assert.equal(failing.stderr, '', 'a failed check is a report, not an error');

  const failingJson = await phdude(ws, ['cite', 'check', '--json', ...ACTOR]);
  assert.equal(failingJson.code, 2);
  const report = JSON.parse(failingJson.stdout);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.kind === 'invalid-doi' && f.id === broken.id));

  // A source's DOI is not part of its content-derived id, so `add` cannot correct it in
  // place (re-adding under the same title/year is a no-op, see docs/cli.md). The mistaken
  // record is not yet cited by anything, so it is safe to remove directly and replace with a
  // corrected one, the same recovery this workspace already uses for a corrupted YAML file.
  await unlink(join(ws, 'knowledge', 'sources', `${broken.id}.yaml`));

  const fixed = await runJson(ws, [
    'add',
    'source',
    '--json',
    JSON.stringify({
      title: 'A Study With A Good DOI',
      authors: ['A. One'],
      year: 2024,
      doi: '10.1234/xyz.2024.01',
    }),
  ]);
  await run(ws, [
    'add',
    'evidence',
    '--json',
    JSON.stringify({ source: fixed.id, excerpt: 'A finding.' }),
  ]);

  const passing = await phdude(ws, ['cite', 'check', ...ACTOR]);
  assert.equal(passing.code, 0, 'the check passes once the broken source is gone');
  assert.match(passing.stdout, /^OK/);

  // list reports the fixed source's bibkey and DOI.
  const rows = await runJson(ws, ['cite', 'list']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].doi, '10.1234/xyz.2024.01');
  assert.equal(rows[0].cited_by, 1);

  // export writes a bibliography and records no event.
  const beforeEvents = (await runJson(ws, ['status'])).recentEvents.length;
  const exported = await runJson(ws, ['cite', 'export']);
  assert.equal(exported.count, 1);
  assert.equal(await exists(exported.path), true);
  const afterEvents = (await runJson(ws, ['status'])).recentEvents.length;
  assert.equal(afterEvents, beforeEvents, 'export is derived, not knowledge');
});

test('e2e: matrix (md/csv/--question) and gaps (text/--json) shapes', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-matrix-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Matrix thesis', '--no-git']);

  const rq = await runJson(ws, [
    'add',
    'question',
    '--json',
    JSON.stringify({ text: 'Does X affect Y?', objectives: ['Assess X on Y.'] }),
  ]);
  const source = await runJson(ws, [
    'add',
    'source',
    '--json',
    JSON.stringify({
      title: 'A Foundational Study',
      authors: ['A. One'],
      year: 2022,
      type: 'article',
    }),
  ]);
  const evidence = await runJson(ws, [
    'add',
    'evidence',
    '--json',
    JSON.stringify({ source: source.id, excerpt: 'X strongly predicts Y.', strength: 'strong' }),
  ]);
  const claim = await runJson(ws, [
    'add',
    'claim',
    '--json',
    JSON.stringify({
      statement: 'X affects Y.',
      kind: 'empirical',
      supported_by: [evidence.id],
      questions: [rq.id],
    }),
  ]);

  const md = await phdude(ws, ['matrix', ...ACTOR]);
  assert.equal(md.code, 0);
  assert.match(
    md.stdout,
    /\| Bibkey \| Year \| Type \| Questions \| Claims \| Strongest evidence \| Facts \| Methods \|/,
  );
  assert.match(md.stdout, new RegExp(rq.id));
  assert.match(md.stdout, new RegExp(claim.id));

  const csv = await runJson(ws, ['matrix', '--format', 'csv']);
  assert.equal(csv.format, 'csv');
  assert.equal(csv.rows.length, 1);
  assert.equal(csv.rows[0].id, source.id);
  assert.deepEqual(csv.rows[0].questions, [rq.id]);
  assert.deepEqual(csv.rows[0].claims, [claim.id]);
  assert.equal(csv.rows[0].claimCount, 1);
  assert.equal(csv.rows[0].strongestEvidence, 'strong');
  assert.equal(csv.rows[0].cited, true);

  const csvText = await phdude(ws, ['matrix', '--format', 'csv', ...ACTOR]);
  assert.equal(csvText.code, 0);
  assert.match(
    csvText.stdout,
    /^Bibkey,Year,Type,Questions,Claims,Strongest evidence,Facts,Methods/,
  );

  const filtered = await runJson(ws, ['matrix', '--question', rq.id]);
  assert.equal(filtered.rows.length, 1);

  const unknownQuestion = await phdude(ws, ['matrix', '--question', 'RQ-999', ...ACTOR]);
  assert.equal(unknownQuestion.code, 1);
  assert.match(unknownQuestion.stderr, /not found: RQ-999/);
  assert.match(unknownQuestion.stderr, /phdude knowledge list --type question/);

  const unknownType = await phdude(ws, ['knowledge', 'list', '--type', 'bogus', ...ACTOR]);
  assert.equal(unknownType.code, 1);
  assert.match(unknownType.stderr, /unknown type: bogus/);
  assert.match(unknownType.stderr, /valid types: /);

  const unknownState = await phdude(ws, ['knowledge', 'list', '--state', 'bogus', ...ACTOR]);
  assert.equal(unknownState.code, 1);
  assert.match(unknownState.stderr, /unknown state: bogus/);
  assert.match(unknownState.stderr, /valid states: /);

  const badFormat = await phdude(ws, ['matrix', '--format', 'xml', ...ACTOR]);
  assert.equal(badFormat.code, 1);
  assert.match(badFormat.stderr, /unknown matrix format/);

  const gapsReport = await runJson(ws, ['gaps']);
  assert.ok(Array.isArray(gapsReport.gaps));
  assert.equal(typeof gapsReport.counts.high, 'number');
  assert.equal(typeof gapsReport.counts.medium, 'number');
  assert.equal(typeof gapsReport.counts.low, 'number');
  assert.ok(
    gapsReport.gaps.some((g) => g.kind === 'question-without-method' && g.id === rq.id),
    'no method addresses rq, so question-without-method should fire',
  );
  for (const g of gapsReport.gaps) {
    assert.ok(['high', 'medium', 'low'].includes(g.severity));
    assert.equal(typeof g.why, 'string');
    assert.equal(typeof g.command, 'string');
  }

  const gapsText = await phdude(ws, ['gaps', ...ACTOR]);
  assert.equal(gapsText.code, 0);
  assert.match(gapsText.stdout, /HIGH \(\d+\):/);
  assert.match(gapsText.stdout, /MEDIUM \(\d+\):/);
  assert.match(gapsText.stdout, /LOW \(\d+\):/);
});

test('e2e: research refuses without network, then searches, records and lists candidates', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-research-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  const init = await run(ws, ['init', '--title', 'Research engine', '--no-git']);

  // The research skill declares network access, which the default policy does not grant: init
  // says so by name and still succeeds.
  assert.match(init.stdout, /skill research was not installed/);
  assert.match(init.stdout, /set skills\.allow_network: true/);
  assert.equal(await exists(join(ws, '.phdude', 'skills', 'research', 'SKILL.md')), false);
  assert.equal(await exists(join(ws, '.claude', 'commands', 'phdude-research.md')), true);
  assert.ok(await exists(join(ws, 'knowledge', 'candidates')), 'init creates knowledge/candidates');
  assert.ok(await exists(join(ws, 'research', 'searches')), 'init creates research/searches');

  const routes = join(REPO_ROOT, 'tests', 'fixtures', 'search', 'e2e-routes.json');
  const env = { PHDUDE_FAKE_FETCH: routes };

  // Closed by default: the refusal names the two ways to open it, and exits 3.
  const refused = await phdude(ws, ['research', 'open science', '--json', ...ACTOR], env);
  assert.equal(refused.code, 3);
  const refusal = JSON.parse(refused.stderr).error;
  assert.equal(refusal.code, 'POLICY');
  assert.equal(refusal.message, 'network access is disabled');
  assert.match(refusal.hint, /--allow-network/);

  const question = await runJson(ws, [
    'add',
    'question',
    '--json',
    JSON.stringify({ text: 'How do open science practices spread?' }),
  ]);

  const searched = await runJson(
    ws,
    ['research', 'open science', '--question', question.id, '--allow-network'],
    env,
  );

  assert.deepEqual(searched.warnings, []);
  assert.equal(searched.candidates.created.length, 4, 'three providers, four distinct works');
  assert.deepEqual(searched.candidates.existing, []);
  assert.deepEqual(searched.search.providers, ['openalex', 'crossref', 'arxiv']);
  assert.equal(searched.search.question, question.id);
  assert.deepEqual(
    searched.search.runs.map((r) => [r.provider, r.count, r.new]),
    [
      ['openalex', 3, 3],
      ['crossref', 3, 0],
      ['arxiv', 2, 1],
    ],
    'crossref returned only works openalex already had; arxiv added one of its own',
  );
  for (const candidate of searched.results) {
    assert.equal(candidate.question, question.id);
    assert.ok(candidate.providers.includes(candidate.provider));
    assert.equal(typeof candidate.score_parts.rank, 'number');
  }
  const shared = searched.results.find((c) => c.title.startsWith('A Preprint on'));
  assert.deepEqual(
    shared.providers,
    ['openalex', 'crossref', 'arxiv'],
    'all three providers returned the same preprint, and it is one candidate',
  );
  const preprint = searched.results.find((c) => c.type === 'preprint');
  assert.equal(preprint.needs_approval, true, 'the policy requires approval for preprints');

  // One event per provider call, carrying the query and a count, never a result.
  const events = (await readFile(join(ws, '.phdude', 'events.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((e) => e.op === 'search');
  assert.deepEqual(
    events.map((e) => e.summary),
    [
      'openalex: "open science" → 3 results',
      'crossref: "open science" → 3 results',
      'arxiv: "open science" → 2 results',
    ],
  );
  assert.deepEqual(events[0].ids, [searched.search.id]);

  // A second run of the same query adds nothing and extends the same search record.
  const again = await runJson(
    ws,
    ['research', 'open science', '--question', question.id, '--allow-network'],
    env,
  );
  assert.deepEqual(again.candidates.created, []);
  assert.equal(again.candidates.existing.length, 4);
  assert.equal(again.search.id, searched.search.id);
  assert.equal(again.search.runs.length, 6);

  const listed = await runJson(ws, ['research', 'list', '--state', 'candidate']);
  assert.equal(listed.length, 4);
  const shown = await runJson(ws, ['research', 'show', listed[0].id]);
  assert.equal(shown.id, listed[0].id);
  assert.equal(shown.schema, 'phdude.candidate');

  const text = await run(ws, ['research', 'list']);
  assert.match(text.stdout, /4 candidate\(s\)/);
  assert.match(text.stdout, /\[needs approval\]/);

  // Narrowing to one provider only calls that one.
  const narrowed = await runJson(
    ws,
    ['research', 'reproducible pipelines', '--provider', 'crossref', '--allow-network'],
    env,
  );
  assert.deepEqual(narrowed.search.providers, ['crossref']);
  assert.deepEqual(
    narrowed.candidates.created,
    [],
    'narrowing to one provider re-finds the same works, it does not duplicate them',
  );
  assert.equal(narrowed.candidates.existing.length, 3);

  // A provider the policy never listed is refused before anything is dispatched: `--provider`
  // narrows the policy's list, it does not replace it.
  const widened = await phdude(
    ws,
    [
      'research',
      'open science',
      '--provider',
      'semantic-scholar',
      '--allow-network',
      '--json',
      ...ACTOR,
    ],
    env,
  );
  assert.equal(widened.code, 1);
  const rejected = JSON.parse(widened.stderr).error;
  assert.equal(rejected.code, 'USAGE');
  assert.equal(rejected.message, 'provider semantic-scholar is not in the workspace policy');
  assert.match(rejected.hint, /research-policy\.yaml/);

  // Opening the policy installs the research skill on the next init.
  const policyPath = join(ws, '.phdude', 'research-policy.yaml');
  await writeFile(
    policyPath,
    (await readFile(policyPath, 'utf8'))
      .replace('allow_network: false', 'allow_network: true')
      .replace('enabled: false', 'enabled: true'),
  );
  const reinit = await run(ws, ['init', '--title', 'Research engine', '--no-git']);
  assert.doesNotMatch(reinit.stdout, /was not installed/);
  assert.equal(await exists(join(ws, '.phdude', 'skills', 'research', 'SKILL.md')), true);

  // With the policy open, no flag is needed.
  const open = await runJson(ws, ['research', 'measurement error'], env);
  assert.equal(open.candidates.created.length, 0, 'the same works are already recorded');
  assert.equal(open.candidates.existing.length, 4);
});

test('e2e: research, accept, dismiss, cite check, edit, freshness and research-fresh', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-accept-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Accepting candidates', '--no-git']);
  const routes = join(REPO_ROOT, 'tests', 'fixtures', 'search', 'e2e-routes.json');
  const env = { PHDUDE_FAKE_FETCH: routes };

  const question = await runJson(ws, [
    'add',
    'question',
    '--json',
    JSON.stringify({ text: 'How do open science practices spread?' }),
  ]);

  const searched = await runJson(
    ws,
    ['research', 'open science', '--question', question.id, '--allow-network'],
    env,
  );
  assert.equal(searched.candidates.created.length, 4);

  const listed = await runJson(ws, ['research', 'list', '--state', 'candidate']);
  const preprint = listed.find((c) => c.needs_approval);
  const article = listed.find((c) => !c.needs_approval && c.doi);
  const spare = listed.find((c) => c.id !== preprint.id && c.id !== article.id);

  // A preprint the policy flagged is refused until the researcher has said yes to that one.
  const refused = await phdude(ws, ['research', 'accept', preprint.id, '--json', ...ACTOR], env);
  assert.equal(refused.code, 1);
  const refusal = JSON.parse(refused.stderr).error;
  assert.equal(refusal.code, 'USAGE');
  assert.match(refusal.hint, /--approve-preprint/);
  assert.equal((await runJson(ws, ['research', 'show', preprint.id])).state, 'candidate');

  const accepted = await runJson(ws, ['research', 'accept', article.id, '--type', 'article']);
  assert.equal(accepted.created, true);
  assert.equal(accepted.candidate.state, 'accepted');
  assert.equal(accepted.candidate.accepted_as, accepted.source.id);
  assert.equal(accepted.source.identifiers.doi, article.doi);
  assert.deepEqual(accepted.source.provenance, { method: 'imported', derived_from: [] });
  assert.equal(accepted.source.ext.research.candidate, article.id);
  assert.ok(
    await exists(join(ws, 'knowledge', 'sources', `${accepted.source.id}.yaml`)),
    'the source is written to knowledge/sources',
  );

  const approved = await runJson(ws, ['research', 'accept', preprint.id, '--approve-preprint']);
  assert.equal(approved.source.type, 'preprint');

  const dismissed = await runJson(ws, [
    'research',
    'dismiss',
    spare.id,
    '--reason',
    'measures a different construct',
  ]);
  assert.equal(dismissed.state, 'dismissed');
  assert.equal(dismissed.reason, 'measures a different construct');

  const events = (await readFile(join(ws, '.phdude', 'events.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((e) => e.op === 'research');
  assert.deepEqual(
    events.map((e) => e.summary),
    [
      `accepted ${article.id} as ${accepted.source.id}`,
      `accepted ${preprint.id} as ${approved.source.id}`,
      `dismissed ${spare.id}: measures a different construct`,
    ],
  );

  // Accepted sources are recorded but not yet cited, which `cite check` reports without failing.
  const checked = await runJson(ws, ['cite', 'check']);
  assert.equal(checked.ok, true);
  const uncited = checked.findings.filter((f) => f.kind === 'uncited-source').map((f) => f.id);
  assert.deepEqual(uncited.sort(), [accepted.source.id, approved.source.id].sort());
  const registry = await runJson(ws, ['cite', 'list']);
  assert.equal(registry.length, 2);
  assert.ok(registry.every((row) => row.bibkey));

  // A field the provider did not fill is corrected in place; the identity fields are not.
  const edited = await runJson(ws, [
    'edit',
    accepted.source.id,
    '--json',
    JSON.stringify({ venue: 'Journal of Research Practice', tags: ['read'] }),
  ]);
  assert.equal(edited.id, accepted.source.id);
  assert.equal(edited.venue, 'Journal of Research Practice');

  const rejectedEdit = await phdude(
    ws,
    ['edit', accepted.source.id, '--json', JSON.stringify({ title: 'Something else' }), '--json'],
    env,
  );
  assert.equal(rejectedEdit.code, 2);
  assert.match(JSON.parse(rejectedEdit.stderr).error.message, /identity field/);

  const editEvents = (await readFile(join(ws, '.phdude', 'events.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((e) => e.op === 'edit');
  assert.deepEqual(
    editEvents.map((e) => e.summary),
    [`edited ${accepted.source.id}: tags, venue`],
  );

  // Freshness: the question was searched a moment ago, so nothing is stale and nothing re-runs.
  const fresh = await runJson(ws, ['freshness']);
  assert.equal(fresh.questions.length, 1);
  assert.equal(fresh.questions[0].question, question.id);
  assert.equal(fresh.questions[0].stale, false);
  assert.equal(fresh.summary.searches, 1);
  assert.equal(fresh.summary.sources, 2);

  const freshText = await run(ws, ['freshness']);
  assert.match(freshText.stdout, /Questions \(1\): 0 stale, 0 never searched/);

  // research-fresh reaches the network, so it refuses on a closed policy exactly like research.
  const closed = await phdude(ws, ['research-fresh', '--json', ...ACTOR], env);
  assert.equal(closed.code, 3);
  assert.equal(JSON.parse(closed.stderr).error.code, 'POLICY');

  const nothingDue = await runJson(ws, ['research-fresh', '--allow-network'], env);
  assert.deepEqual(nothingDue.reran, [], 'a search run a moment ago is not stale');
  assert.deepEqual(nothingDue.newCandidates, []);

  const all = await runJson(ws, ['research-fresh', '--all', '--allow-network'], env);
  assert.deepEqual(all.reran, [searched.search.id]);
  assert.deepEqual(all.newCandidates, [], 'the same literature again is not news');
  const text = await run(ws, ['research-fresh', '--all', '--allow-network'], env);
  assert.match(text.stdout, /1 search\(es\) re-run, 0 new candidate\(s\)/);

  // Re-running never resets a review the researcher already made.
  const after = await runJson(ws, ['research', 'list']);
  assert.deepEqual(
    after
      .filter((c) => c.state !== 'candidate')
      .map((c) => c.state)
      .sort(),
    ['accepted', 'accepted', 'dismissed'],
  );
});

test('e2e: prose reports on any text file, in either language, and refuses detector flags', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-prose-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  const slop = join(REPO_ROOT, 'tests', 'fixtures', 'prose', 'en', 'slop.md');
  const clean = join(REPO_ROOT, 'tests', 'fixtures', 'prose', 'en', 'clean.md');

  // No workspace is needed: the report is over a text file, and the academic-prose skill's
  // wrapper script reaches this command from anywhere.
  const report = await runJson(ws, ['prose', '--file', slop]);
  assert.equal(report.file, slop);
  assert.ok(report.observations.length >= 9, 'the slop fixture trips most of the rules');
  assert.deepEqual(Object.keys(report.scores), [
    'specificity',
    'evidenceAlignment',
    'epistemicPrecision',
    'structuralVariation',
    'authorVoice',
    'conciseness',
  ]);
  assert.equal(report.scores.evidenceAlignment, null, 'a bare file has no evidence graph');
  assert.equal(typeof report.formulas.specificity, 'string');
  for (const o of report.observations) {
    assert.ok(Number.isInteger(o.line) && o.line >= 1);
    assert.ok(['warn', 'info'].includes(o.severity), o.severity);
  }

  const text = await run(ws, ['prose', '--file', slop]);
  assert.match(text.stdout, /^Academic Prose Quality: \d+\/100/);
  assert.match(text.stdout, /Evidence Alignment {6}n\/a \(needs manuscript context\)/);
  assert.match(text.stdout, /vague-literature: /);

  // A report never blocks: clean prose and sloppy prose both exit 0.
  const cleanReport = await runJson(ws, ['prose', '--file', clean]);
  assert.deepEqual(cleanReport.observations, []);
  assert.equal(cleanReport.scores.specificity, 100);

  const spanish = await runJson(ws, [
    'prose',
    '--file',
    join(REPO_ROOT, 'tests', 'fixtures', 'prose', 'es', 'slop.md'),
    '--lang',
    'es',
  ]);
  assert.equal(spanish.lang, 'es');
  assert.ok(spanish.observations.some((o) => o.rule === 'banned-phrase'));

  const german = await runJson(ws, ['prose', '--file', clean, '--lang', 'de']);
  assert.ok(
    german.observations.some((o) => o.rule === 'unsupported-language' && o.severity === 'info'),
    'an unsupported language says so instead of reporting nothing',
  );

  // PRD §30c: PhDude has no AI-detector score, so the flag that asks for one is a policy error.
  for (const flag of ['--detector', '--humanize-to', '--detector-target=0.1']) {
    const refused = await phdude(ws, ['prose', '--file', clean, flag, '--json', ...ACTOR]);
    assert.equal(refused.code, 3, `${flag} should exit 3`);
    const err = JSON.parse(refused.stderr).error;
    assert.equal(err.code, 'POLICY');
    assert.equal(err.message, 'PhDude does not measure or target AI-detector scores');
    assert.match(err.hint, /§30c/);
  }

  const missing = await phdude(ws, ['prose', '--json', ...ACTOR]);
  assert.equal(missing.code, 1, 'prose without --file is a usage error');
  assert.equal(JSON.parse(missing.stderr).error.code, 'USAGE');

  const notThere = await phdude(ws, ['prose', '--file', 'nope.md', '--json', ...ACTOR]);
  assert.equal(notThere.code, 1);
  assert.match(JSON.parse(notThere.stderr).error.message, /^not found: /);
});

test('e2e: manuscript init, a blocked submit, a clean one, approve and reopen', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-manuscript-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Manuscript thesis', '--no-git']);

  const created = await runJson(ws, ['manuscript', 'init', '--voice', 'researcher-a']);
  assert.equal(created.title, 'Manuscript thesis');
  assert.deepEqual(created.voice, { kind: 'author', author: 'researcher-a' });
  assert.equal(created.sections.length, 6);
  assert.equal(
    await exists(join(ws, 'manuscript', 'introduction.md')),
    false,
    'init plans sections, it does not write them',
  );

  // A citation with nothing behind it blocks: exit 2, the finding located, and no file written.
  const draft = join(ws, 'draft.md');
  await writeFile(draft, '# Introduction\n\nSMEs adopt AI slowly [@nobody2000nothing].\n');
  const blocked = await phdude(ws, [
    'manuscript',
    'submit',
    'introduction',
    '--file',
    draft,
    ...ACTOR,
  ]);
  assert.equal(blocked.code, 2);
  assert.match(blocked.stderr, /section blocked by gate-citations: 1 finding\(s\)/);
  assert.match(blocked.stderr, /gate-citations:3 \[@nobody2000nothing\]/);
  assert.equal(await exists(join(ws, 'manuscript', 'introduction.md')), false);

  await run(ws, [
    'add',
    'source',
    '--json',
    JSON.stringify({
      title: 'A Study of Cognitive Load',
      authors: ['Z. Zeta'],
      year: 2020,
      type: 'article',
    }),
  ]);

  await writeFile(draft, '# Introduction\n\nSMEs adopt AI slowly [@zeta2020study].\n');
  const submitted = await runJson(ws, ['manuscript', 'submit', 'introduction', '--file', draft]);
  assert.equal(submitted.section.status, 'draft');
  assert.equal(submitted.report.blocks, 0);
  const sectionText = await readFile(join(ws, 'manuscript', 'introduction.md'), 'utf8');
  assert.match(sectionText, /^---\nsection: introduction\nstatus: draft\n/);
  assert.match(sectionText, /SMEs adopt AI slowly \[@zeta2020study\]\./);

  const report = await readFile(join(ws, 'manuscript', 'reports', 'introduction.yaml'), 'utf8');
  assert.match(report, /gate: gate-citations/);

  // Approving needs an approved decision that names the section.
  const notYet = await phdude(ws, ['manuscript', 'approve', 'introduction', ...ACTOR]);
  assert.equal(notYet.code, 1);

  const decision = await runJson(ws, [
    'decide',
    'propose',
    '--title',
    'Approve the introduction',
    '--rationale',
    'Read end to end by the supervisor.',
    '--affects',
    'manuscript:introduction',
  ]);
  const unapproved = await phdude(ws, [
    'manuscript',
    'approve',
    'introduction',
    '--decision',
    decision.id,
    ...ACTOR,
  ]);
  assert.equal(unapproved.code, 3, 'a proposed decision does not approve a section');

  await run(ws, ['decide', 'approve', decision.id, '--by', 'A Supervisor']);
  const approved = await runJson(ws, [
    'manuscript',
    'approve',
    'introduction',
    '--decision',
    decision.id,
  ]);
  assert.equal(approved.section.status, 'approved');
  assert.equal(approved.section.approved_by, decision.id);

  const overwrite = await phdude(ws, [
    'manuscript',
    'submit',
    'introduction',
    '--file',
    draft,
    ...ACTOR,
  ]);
  assert.equal(overwrite.code, 3, 'approved text is not overwritten');

  const reopened = await runJson(ws, ['manuscript', 'reopen', 'introduction']);
  assert.equal(reopened.section.status, 'revised');

  const status = await runJson(ws, ['manuscript', 'status']);
  assert.deepEqual(status.counts, { planned: 5, draft: 0, revised: 1, approved: 0 });

  const statusText = await run(ws, ['manuscript', 'status']);
  assert.match(statusText.stdout, /voice researcher-a/);

  const events = (await readFile(join(ws, '.phdude', 'events.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.op === 'manuscript');
  assert.deepEqual(
    events.map((e) => e.summary),
    [
      'manuscript initialized (6 sections)',
      'submitted introduction (draft)',
      `approved introduction (${decision.id})`,
      'reopened introduction (revised)',
    ],
  );
});

test('e2e: write, submit, deslop and prose over one section', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-writing-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Writing thesis', '--no-git']);

  const source = await runJson(ws, [
    'add',
    'source',
    '--json',
    JSON.stringify({
      title: 'Adoption of AI in Small Firms',
      authors: ['Z. Zeta'],
      year: 2020,
      type: 'article',
    }),
  ]);
  const question = await runJson(ws, [
    'add',
    'question',
    '--json',
    JSON.stringify({ text: 'How fast do small firms adopt AI?', objectives: ['Measure the lag'] }),
  ]);
  const evidence = await runJson(ws, [
    'add',
    'evidence',
    '--json',
    JSON.stringify({
      source: source.id,
      locator: 'p. 3',
      excerpt: 'Adoption is slower among firms below fifty employees.',
      strength: 'moderate',
    }),
  ]);
  const claim = await runJson(ws, [
    'add',
    'claim',
    '--json',
    JSON.stringify({
      statement: 'Small firms adopt AI more slowly than large ones.',
      kind: 'empirical',
      supported_by: [evidence.id],
      questions: [question.id],
      sections: ['Introduction'],
    }),
  ]);
  await run(ws, ['promote', claim.id, '--to', 'supported']);
  await run(ws, ['manuscript', 'init']);

  // next recommends drafting the section whose evidence is already in.
  const planned = await runJson(ws, ['next']);
  const ready = planned.actions.find((a) => a.rule === 'sections-planned');
  assert.ok(ready, 'sections-planned is recommended');
  assert.equal(ready.command, 'phdude write introduction');

  // write assembles the context and prints the contract; it writes no section file.
  const context = await runJson(ws, ['write', 'introduction']);
  assert.deepEqual(
    context.included.map((item) => item.kind),
    ['instruction', 'facts', 'claim', 'bibkeys', 'policy', 'voice', 'epistemic'],
  );
  const contextFile = await readFile(
    join(ws, '.phdude', 'cache', 'writing', 'introduction', 'context.md'),
    'utf8',
  );
  assert.match(contextFile, new RegExp(`<!-- claim: ${claim.id} -->`));
  assert.equal(await exists(join(ws, 'manuscript', 'introduction.md')), false);

  const text = await run(ws, ['write', 'introduction']);
  assert.match(text.stdout, /Draft contract:/);
  assert.match(text.stdout, /phdude manuscript submit introduction --file/);

  // A verb the claim's state does not allow blocks: exit 2, the finding printed first, and no
  // section file written.
  const bad = join(ws, 'bad.md');
  await writeFile(
    bad,
    `Adoption demonstrates a clear lag [@zeta2020adoption].\n<!-- claim: ${claim.id} -->\n`,
  );
  const blocked = await phdude(ws, [
    'manuscript',
    'submit',
    'introduction',
    '--file',
    bad,
    ...ACTOR,
  ]);
  assert.equal(blocked.code, 2);
  assert.match(blocked.stderr, /^ {2}- gate-evidence:1 "demonstrates" claims more than/m);
  assert.ok(
    blocked.stderr.indexOf('gate-evidence:1') < blocked.stderr.indexOf('section blocked by'),
    'the findings are printed before the error line',
  );
  assert.equal(await exists(join(ws, 'manuscript', 'introduction.md')), false);

  // The clean draft passes every gate.
  const draft = join(ws, 'draft.md');
  const body = [
    'Small firms move toward automated tooling at their own pace, and the surveyed population',
    'shows the same lag in every recruitment channel we examined [@zeta2020adoption].',
    `<!-- claim: ${claim.id} -->`,
    '',
    'The gap matters because the firms that lag have the least slack to recover it. This section',
    'sets out the question the rest of the thesis answers.',
  ].join('\n');
  await writeFile(draft, body + '\n');

  const submitted = await runJson(ws, ['manuscript', 'submit', 'introduction', '--file', draft]);
  assert.equal(submitted.section.status, 'draft');
  assert.deepEqual(
    submitted.report.gates.map((row) => row.gate),
    ['gate-citations', 'gate-evidence', 'gate-prose', 'gate-voice', 'gate-profile'],
  );

  // deslop without a file: the observations and the revision contract, and no event.
  const contract = await run(ws, ['deslop', 'introduction']);
  assert.match(contract.stdout, /Revision contract for introduction \(draft\)/);
  assert.match(contract.stdout, /Preserve exactly/);
  assert.match(contract.stdout, /Every number, exactly as written\./);

  // A revision that drops the citation is refused, and the section stays a draft.
  const dropped = join(ws, 'dropped.md');
  await writeFile(dropped, body.replace(' [@zeta2020adoption]', '') + '\n');
  const refused = await phdude(ws, ['deslop', 'introduction', '--file', dropped, ...ACTOR]);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /gate-meaning:1 the revision drops the citation zeta2020adoption/);

  const stillDraft = await runJson(ws, ['manuscript', 'show', 'introduction']);
  assert.equal(stillDraft.status, 'draft');

  // A revision that keeps every claim, citation, number and negation is recorded.
  const revision = join(ws, 'revision.md');
  await writeFile(
    revision,
    [
      'Across every recruitment channel we examined, small firms move toward automated tooling at',
      'their own pace [@zeta2020adoption].',
      `<!-- claim: ${claim.id} -->`,
      '',
      'The firms that lag have the least slack to recover it, which is why the gap matters. This',
      'section sets out the question the rest of the thesis answers.',
    ].join('\n') + '\n',
  );
  const revised = await runJson(ws, ['deslop', 'introduction', '--file', revision]);
  assert.equal(revised.revised, true);
  assert.equal(revised.section.status, 'revised');

  // The prose report scores the section against the evidence graph and stores the scores.
  const report = await runJson(ws, ['prose', 'introduction']);
  assert.equal(typeof report.scores.evidenceAlignment, 'number');
  assert.equal(report.scores.authorVoice, null);
  const stored = await readFile(join(ws, 'manuscript', 'reports', 'introduction.yaml'), 'utf8');
  assert.match(stored, /evidenceAlignment: \d+/);

  const proseText = await run(ws, ['prose', 'introduction']);
  assert.match(proseText.stdout, /^introduction \(revised\) {2}Introduction/m);
  assert.match(proseText.stdout, /Academic Prose Quality: \d+\/100/);

  // The researcher approves it with a decision; next then has nothing pending.
  const decision = await runJson(ws, [
    'decide',
    'propose',
    '--title',
    'Approve the introduction',
    '--rationale',
    'It reads as intended and every claim resolves.',
    '--affects',
    'manuscript:introduction',
  ]);
  await run(ws, ['decide', 'approve', decision.id, '--by', 'the researcher']);

  const pending = await runJson(ws, ['next']);
  assert.ok(pending.actions.some((a) => a.rule === 'approval-pending'));

  await run(ws, ['manuscript', 'approve', 'introduction', '--decision', decision.id]);
  const approved = await runJson(ws, ['manuscript', 'show', 'introduction']);
  assert.equal(approved.status, 'approved');

  // An approved section is not deslopped in place.
  const locked = await phdude(ws, ['deslop', 'introduction', ...ACTOR]);
  assert.equal(locked.code, 3);
  assert.match(locked.stderr, /reopen/);

  const events = JSON.parse(
    `[${(await readFile(join(ws, '.phdude', 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .join(',')}]`,
  );
  assert.deepEqual(
    events.filter((e) => e.op === 'manuscript').map((e) => e.summary),
    [
      'manuscript initialized (6 sections)',
      'submitted introduction (draft)',
      'deslop introduction (revised)',
      `approved introduction (${decision.id})`,
    ],
    'one event per mutation, and none for write, deslop --no-file or prose',
  );
});

test('e2e: authors add, learn (paths relative to cwd), consensus', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-authors-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'Author voice profiles', '--no-git']);

  assert.deepEqual(await runJson(ws, ['authors', 'list']), []);

  const addFields = {
    id: 'researcher-a',
    language: 'en',
    tone: { academic: true, assertiveness: 'moderate', first_person: 'sparing' },
    sentences: { length: 'varied', openings: 'varied' },
    paragraphs: { density: 'medium' },
    transitions: 'minimal',
    terminology: { preserve: ['decision process'], avoid: ['leverage'] },
  };
  const added = await runJson(ws, ['authors', 'add', '--json', JSON.stringify(addFields)]);
  assert.equal(added.id, 'researcher-a');
  assert.ok(await exists(join(ws, 'authors', 'researcher-a.yaml')));

  await run(ws, ['authors', 'add', '--json', JSON.stringify({ ...addFields, id: 'researcher-b' })]);

  // `learn`'s paths are relative to the CLI's working directory, not the workspace, so a
  // sample living entirely outside the workspace is still readable, and is recorded as an
  // absolute path since it has no path relative to the workspace.
  const outsideDir = await mkdtemp(join(tmpdir(), 'phdude-e2e-authors-sample-'));
  t.after(() => rm(outsideDir, { recursive: true, force: true }));
  const samplePath = join(outsideDir, 'sample-a.md');
  await writeFile(
    samplePath,
    'We surveyed 312 undergraduate students. However, adoption varies across recruitment channels.',
  );

  const learned = await runJson(ws, [
    'authors',
    'learn',
    'researcher-a',
    '--from',
    samplePath,
    '--approved',
  ]);
  assert.equal(learned.learned.sample_count, 1);
  assert.equal(learned.samples.length, 1);
  assert.equal(learned.samples[0].path, samplePath);
  assert.equal(learned.samples[0].approved, true);

  const shown = await runJson(ws, ['authors', 'show', 'researcher-a']);
  assert.deepEqual(shown, learned);

  const list = await runJson(ws, ['authors', 'list']);
  assert.deepEqual(
    list.map((p) => p.id),
    ['researcher-a', 'researcher-b'],
  );

  const consensusResult = await runJson(ws, ['authors', 'consensus']);
  assert.equal(consensusResult.changed, true);
  assert.equal(consensusResult.decision.title, 'Update project-consensus voice');
  assert.ok(await exists(join(ws, 'authors', 'project-consensus.yaml')));

  const again = await runJson(ws, ['authors', 'consensus']);
  assert.equal(again.changed, false);
  assert.equal(again.decision, null);

  const missingFrom = await phdude(ws, ['authors', 'learn', 'researcher-a', '--json', ...ACTOR]);
  assert.equal(missingFrom.code, 1);
  assert.match(JSON.parse(missingFrom.stderr).error.message, /--from/);

  const badId = await phdude(ws, [
    'authors',
    'add',
    '--json',
    JSON.stringify({ ...addFields, id: 'Not_Valid' }),
    '--json',
    ...ACTOR,
  ]);
  assert.equal(badId.code, 2);
});

test('e2e: data add profiles a file under data/, re-adds as a no-op, and versions a change', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-data-'));
  t.after(() => rm(ws, { recursive: true, force: true }));

  await run(ws, ['init', '--title', 'E2E data', '--no-git']);

  const survey = ['id,age,group,joined', '1,31,a,2026-01-02', '2,44,b,2026-02-03', '3,,a,'].join(
    '\n',
  );
  await writeFile(join(ws, 'data', 'survey.csv'), survey + '\n');

  const added = await runJson(ws, [
    'data',
    'add',
    'data/survey.csv',
    '--json',
    '{"description":"Pilot survey","license":"CC-BY-4.0"}',
  ]);
  assert.equal(added.created, true);
  assert.match(added.dataset.id, /^DATASET-[0-9a-f]{10}$/);
  assert.equal(added.dataset.format, 'csv');
  assert.equal(added.dataset.profile.rows, 3);
  assert.deepEqual(
    added.dataset.profile.columns.map((c) => c.inferred_type),
    ['number', 'number', 'string', 'date'],
  );
  assert.ok(
    await exists(join(ws, 'knowledge', 'datasets', `${added.dataset.id}.yaml`)),
    'the record lands in knowledge/datasets/',
  );

  // Re-adding the same bytes is a no-op the researcher can see.
  const again = await run(ws, ['data', 'add', 'data/survey.csv']);
  assert.match(again.stdout, /^Unchanged DATASET-/);

  // A dataset outside data/ is refused before anything is read.
  await writeFile(join(ws, 'sources', 'stray.csv'), 'a,b\n1,2\n');
  const outside = await phdude(ws, ['data', 'add', 'sources/stray.csv', ...ACTOR]);
  assert.equal(outside.code, 2);
  assert.match(outside.stderr, /outside data\//);

  // Editing the file records a new dataset linked to the first.
  await writeFile(join(ws, 'data', 'survey.csv'), survey + '\n4,52,b,2026-03-04\n');
  const changed = await runJson(ws, ['data', 'add', 'data/survey.csv']);
  assert.equal(changed.created, true);
  assert.equal(changed.dataset.versions_of, added.dataset.id);
  assert.deepEqual(changed.replaced, [added.dataset.id]);

  const listed = await runJson(ws, ['data', 'list']);
  assert.equal(listed.length, 2);
  const listedText = await run(ws, ['data', 'list']);
  assert.match(listedText.stdout, /superseded/);

  const profile = await runJson(ws, ['data', 'profile', changed.dataset.id]);
  assert.equal(profile.rows, 4);
  assert.deepEqual(
    profile.columns.map((c) => c.name),
    ['id', 'age', 'group', 'joined'],
  );
  const profileText = await run(ws, ['data', 'profile', changed.dataset.id]);
  assert.match(profileText.stdout, /Column +Type +Missing +Distinct +Samples/);

  const shown = await runJson(ws, ['data', 'show', changed.dataset.id]);
  assert.equal(shown.id, changed.dataset.id);

  // A sensitive dataset keeps its cell values out of the committed profile.
  await writeFile(join(ws, 'data', 'people.csv'), 'name,email\nAda,ada@example.org\n');
  const sensitive = await runJson(ws, [
    'data',
    'add',
    'data/people.csv',
    '--json',
    '{"sensitive":true}',
  ]);
  for (const column of sensitive.dataset.profile.columns) {
    assert.equal(Object.hasOwn(column, 'samples'), false, `${column.name} leaked samples`);
  }

  const events = (await readFile(join(ws, '.phdude', 'events.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((e) => e.op === 'data');
  assert.equal(events.length, 3, 'one data event per registration, none for the no-op');
});

test('e2e: table build and figure build through the CLI, with the execution policy in the way', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'phdude-e2e-figures-'));
  t.after(() => rm(ws, { recursive: true, force: true }));
  await run(ws, ['init', '--title', 'Figures e2e', '--no-git']);

  const survey = ['id,age,group', '1,31,a', '2,44,b', '3,52,a'].join('\n') + '\n';
  await writeFile(join(ws, 'data', 'survey.csv'), survey);
  const dataset = (await runJson(ws, ['data', 'add', 'data/survey.csv'])).dataset;

  // A table over the dataset renders three files and records what it read.
  const declared = await runJson(ws, [
    'table',
    'add',
    '--json',
    JSON.stringify({
      name: 'respondents',
      caption: 'Every respondent, by group.',
      source: { dataset: dataset.id, columns: ['group', 'age'] },
      columns: [
        { key: 'group', label: 'Group' },
        { key: 'age', label: 'Age', format: 'number:0' },
      ],
    }),
  ]);
  assert.equal(declared.created, true);
  assert.match(declared.table.id, /^TABLE-[0-9a-f]{10}$/);

  const built = await runJson(ws, ['table', 'build', declared.table.id]);
  assert.equal(built.built, true);
  assert.equal(
    await readFile(join(ws, 'tables', 'out', 'respondents.md'), 'utf8'),
    [
      '| Group | Age |',
      '| --- | ---: |',
      '| a | 31 |',
      '| b | 44 |',
      '| a | 52 |',
      '',
      'Table: Every respondent, by group.',
      '',
    ].join('\n'),
  );
  assert.match(
    await readFile(join(ws, 'tables', 'out', 'respondents.tex'), 'utf8'),
    /\\label\{tab:respondents\}/,
  );

  const again = await run(ws, ['table', 'build', declared.table.id]);
  assert.match(again.stdout, /is up to date/);

  // A figure needs alt text before it is a record at all.
  const noAlt = await phdude(ws, [
    'figure',
    'add',
    '--json',
    JSON.stringify({
      name: 'groups',
      caption: 'Respondents per group.',
      alt: '',
      generator: { runtime: 'node', script: 'phdude:bar-chart', args: [] },
      inputs: [],
      outputs: [{ path: 'figures/out/groups.svg', format: 'svg' }],
    }),
    ...ACTOR,
  ]);
  assert.equal(noAlt.code, 2);
  assert.match(noAlt.stderr, /a figure needs alt text/);

  const alt = 'Groups a and b hold two and one respondents; group a is the larger.';
  const figure = await runJson(ws, [
    'figure',
    'add',
    '--json',
    JSON.stringify({
      name: 'groups',
      caption: 'Respondents per group.',
      alt,
      generator: {
        runtime: 'node',
        script: 'phdude:bar-chart',
        args: [
          '--input',
          'data/survey.csv',
          '--key',
          'group',
          '--out',
          'figures/out/groups.svg',
          '--title',
          'Respondents per group',
          '--alt',
          alt,
        ],
      },
      inputs: [dataset.id],
      outputs: [{ path: 'figures/out/groups.svg', format: 'svg' }],
    }),
  ]);
  assert.match(figure.figure.id, /^FIG-[0-9a-f]{10}$/);

  // The default policy leaves execution closed.
  const refused = await phdude(ws, ['figure', 'build', figure.figure.id, ...ACTOR]);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, /script execution is disabled/);
  assert.match(refused.stderr, /--allow-exec/);

  const check = await runJson(ws, ['figure', 'check']);
  assert.equal(check.figures[0].status, 'never-run');

  const drawn = await runJson(ws, ['figure', 'build', figure.figure.id, '--allow-exec']);
  assert.equal(drawn.run.exit, 0);
  const svg = await readFile(join(ws, 'figures', 'out', 'groups.svg'), 'utf8');
  assert.match(svg, new RegExp(`<desc id="figure-desc">${alt.replace(/[.]/g, '\\.')}</desc>`));
  assert.equal(drawn.run.output_hashes['figures/out/groups.svg'].length, 64);

  assert.equal((await runJson(ws, ['figure', 'check'])).figures[0].status, 'up-to-date');

  // Editing the data under the figure makes it stale, without anything having watched the file.
  await writeFile(join(ws, 'data', 'survey.csv'), survey + '4,29,c\n');
  const stale = await run(ws, ['figure', 'check']);
  assert.match(stale.stdout, /stale/);
  assert.match(stale.stdout, /input changed since the last build/);

  const events = (await readFile(join(ws, '.phdude', 'events.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(events.filter((e) => e.op === 'table').length, 2, 'one declaration, one build');
  assert.equal(events.filter((e) => e.op === 'figure').length, 2, 'one declaration, one build');
});

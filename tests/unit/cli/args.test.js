import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCli } from '../../../src/adapters/cli/args.js';

test('parseCli: bare command', () => {
  const cli = parseCli(['status']);
  assert.equal(cli.command, 'status');
  assert.equal(cli.sub, null);
  assert.deepEqual(cli.positionals, ['status']);
  assert.equal(cli.flags.json, false);
  assert.equal(cli.flags.jsonPayload, null);
});

test('parseCli: no arguments yields a null command', () => {
  const cli = parseCli([]);
  assert.equal(cli.command, null);
  assert.equal(cli.sub, null);
  assert.deepEqual(cli.positionals, []);
});

test('parseCli: sub-command with filters', () => {
  const cli = parseCli(['knowledge', 'list', '--type', 'claim', '--state', 'candidate', '--json']);
  assert.equal(cli.command, 'knowledge');
  assert.equal(cli.sub, 'list');
  assert.equal(cli.flags.type, 'claim');
  assert.equal(cli.flags.state, 'candidate');
  assert.equal(cli.flags.json, true);
  assert.equal(cli.flags.jsonPayload, null);
});

test('parseCli: --json carrying an object is a payload, not just the output flag', () => {
  const cli = parseCli(['add', 'claim', '--json', '{"statement":"x"}']);
  assert.equal(cli.command, 'add');
  assert.equal(cli.sub, 'claim');
  assert.equal(cli.flags.json, true);
  assert.equal(cli.flags.jsonPayload, '{"statement":"x"}');
  assert.deepEqual(cli.positionals, ['add', 'claim']);
});

test('parseCli: --json=<object> form', () => {
  const cli = parseCli(['add', 'fact', '--json={"key":"sample_size","value":10}']);
  assert.equal(cli.flags.json, true);
  assert.equal(cli.flags.jsonPayload, '{"key":"sample_size","value":10}');
});

test('parseCli: --actor researcher=<name>,agent=<host>', () => {
  const cli = parseCli(['status', '--actor', 'researcher=lucio,agent=claude-code']);
  assert.deepEqual(cli.flags.actor, { researcher: 'lucio', agent: 'claude-code' });
});

test('parseCli: --actor without pairs is the researcher name', () => {
  const cli = parseCli(['status', '--actor', 'lucio']);
  assert.deepEqual(cli.flags.actor, { researcher: 'lucio' });
});

test('parseCli: --actor is null when absent', () => {
  assert.equal(parseCli(['status']).flags.actor, null);
});

test('parseCli: init positional dir, title, agents and --no-git', () => {
  const cli = parseCli([
    'init',
    'my-dir',
    '--title',
    'My thesis',
    '--agents',
    'claude-code,codex',
    '--no-git',
  ]);
  assert.equal(cli.command, 'init');
  assert.deepEqual(cli.positionals, ['init', 'my-dir']);
  assert.equal(cli.flags.title, 'My thesis');
  assert.deepEqual(cli.flags.agents, ['claude-code', 'codex']);
  assert.equal(cli.flags.noGit, true);
});

test('parseCli: --affects takes several ids after one flag', () => {
  const cli = parseCli([
    'decide',
    'propose',
    '--title',
    'Resolve sample_size',
    '--affects',
    'FACT-aaaaaaaaaa',
    'FACT-bbbbbbbbbb',
    '--change',
    '{"fact_key":"sample_size"}',
  ]);
  assert.deepEqual(cli.flags.affects, ['FACT-aaaaaaaaaa', 'FACT-bbbbbbbbbb']);
  assert.equal(cli.flags.change, '{"fact_key":"sample_size"}');
  assert.deepEqual(cli.positionals, ['decide', 'propose']);
});

test('parseCli: --affects may also be repeated', () => {
  const cli = parseCli(['decide', 'propose', '--affects', 'FACT-a', '--affects', 'FACT-b']);
  assert.deepEqual(cli.flags.affects, ['FACT-a', 'FACT-b']);
});

test('parseCli: ingest keeps extra positionals as paths', () => {
  const cli = parseCli(['ingest', 'sources', 'data', '--force']);
  assert.deepEqual(cli.positionals, ['ingest', 'sources', 'data']);
  assert.equal(cli.flags.force, true);
});

test('parseCli: decide approve carries the id and --by', () => {
  const cli = parseCli(['decide', 'approve', 'DEC-0123456789', '--by', 'lucio']);
  assert.equal(cli.command, 'decide');
  assert.equal(cli.sub, 'approve');
  assert.deepEqual(cli.positionals, ['decide', 'approve', 'DEC-0123456789']);
  assert.equal(cli.flags.by, 'lucio');
});

test('parseCli: promote id and --decision', () => {
  const cli = parseCli(['promote', 'CLAIM-0123456789', '--decision', 'DEC-9876543210']);
  assert.equal(cli.command, 'promote');
  assert.equal(cli.sub, 'CLAIM-0123456789');
  assert.equal(cli.flags.decision, 'DEC-9876543210');
});

test('parseCli: --version and --help are flags', () => {
  assert.equal(parseCli(['--version']).flags.version, true);
  assert.equal(parseCli(['-v']).flags.version, true);
  assert.equal(parseCli(['--help']).flags.help, true);
  assert.equal(parseCli(['-h']).flags.help, true);
});

test('parseCli: workspace, file, reason, role, id and to flags', () => {
  const cli = parseCli([
    'add',
    'artifact-role',
    '--workspace',
    '/tmp/ws',
    '--file',
    'role.json',
    '--reason',
    'bad evidence',
    '--role',
    'paper',
    '--id',
    'ART-0123456789',
    '--to',
    'supported',
  ]);
  assert.equal(cli.flags.workspace, '/tmp/ws');
  assert.equal(cli.flags.file, 'role.json');
  assert.equal(cli.flags.reason, 'bad evidence');
  assert.equal(cli.flags.role, 'paper');
  assert.equal(cli.flags.id, 'ART-0123456789');
  assert.equal(cli.flags.to, 'supported');
});

test('parseCli: --paths may be repeated', () => {
  const cli = parseCli(['ingest', '--paths', 'sources', '--paths', 'data']);
  assert.deepEqual(cli.flags.paths, ['sources', 'data']);
});

test('parseCli: parsing is non-strict, so an unknown flag never crashes the CLI', () => {
  const cli = parseCli(['status', '--not-a-real-flag', '--json']);
  assert.equal(cli.command, 'status');
  assert.equal(cli.flags.json, true);
});

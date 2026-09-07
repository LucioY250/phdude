import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMAND_OPTIONS,
  GLOBAL_OPTIONS,
  optionsFor,
  parseCli,
} from '../../../src/adapters/cli/args.js';
import { PhdudeError } from '../../../src/domain/errors.js';

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

test('parseCli: the global --workspace and --file flags work on any command', () => {
  const cli = parseCli(['add', 'artifact-role', '--workspace', '/tmp/ws', '--file', 'role.json']);
  assert.equal(cli.flags.workspace, '/tmp/ws');
  assert.equal(cli.flags.file, 'role.json');
});

test('parseCli: per-command flags reach the flags object', () => {
  const rejected = parseCli([
    'decide',
    'reject',
    'DEC-0123456789',
    '--by',
    'ada',
    '--reason',
    'weak',
  ]);
  assert.equal(rejected.flags.by, 'ada');
  assert.equal(rejected.flags.reason, 'weak');

  const promoted = parseCli(['promote', 'CLAIM-0123456789', '--to', 'supported']);
  assert.equal(promoted.flags.to, 'supported');

  const shown = parseCli(['knowledge', 'show', '--id', 'ART-0123456789']);
  assert.equal(shown.flags.id, 'ART-0123456789');
});

test('parseCli: decide supersede takes --by and --with', () => {
  const cli = parseCli([
    'decide',
    'supersede',
    'DEC-0123456789',
    '--by',
    'Ada Lovelace',
    '--with',
    'DEC-9876543210',
  ]);
  assert.equal(cli.flags.by, 'Ada Lovelace');
  assert.equal(cli.flags.with, 'DEC-9876543210');
});

test('parseCli: --to takes several ids after one flag, like --affects', () => {
  const cli = parseCli(['link', 'CLAIM-0123456789', '--to', 'EVID-a', 'EVID-b', '--json']);
  assert.equal(cli.command, 'link');
  assert.deepEqual(cli.positionals, ['link', 'CLAIM-0123456789']);
  assert.deepEqual(cli.flags.to, ['EVID-a', 'EVID-b']);
  assert.equal(cli.flags.json, true);
});

test('parseCli: --to may be repeated and accepts the --to=<id> form', () => {
  const cli = parseCli(['link', 'CLAIM-0123456789', '--to=EVID-a', '--to', 'EVID-b']);
  assert.deepEqual(cli.flags.to, ['EVID-a', 'EVID-b']);
});

test('parseCli: --to is a plain string everywhere except link', () => {
  const idFirst = parseCli(['promote', 'FACT-0123456789', '--to', 'rejected']);
  assert.equal(idFirst.flags.to, 'rejected');
  assert.deepEqual(idFirst.positionals, ['promote', 'FACT-0123456789']);
});

test('parseCli: authors learn --from takes several paths after one flag, like --affects', () => {
  const cli = parseCli([
    'authors',
    'learn',
    'researcher-a',
    '--from',
    'a.md',
    'b.md',
    '--approved',
  ]);
  assert.equal(cli.command, 'authors');
  assert.deepEqual(cli.positionals, ['authors', 'learn', 'researcher-a']);
  assert.deepEqual(cli.flags.from, ['a.md', 'b.md']);
  assert.equal(cli.flags.approved, true);
});

test('parseCli: authors --from may be repeated and accepts the --from=<path> form', () => {
  const cli = parseCli(['authors', 'learn', 'researcher-a', '--from=a.md', '--from', 'b.md']);
  assert.deepEqual(cli.flags.from, ['a.md', 'b.md']);
});

test('parseCli: --from is a plain string everywhere except authors', () => {
  const cli = parseCli(['research', 'note-taking apps', '--from', '2021']);
  assert.equal(cli.flags.from, '2021');
});

test('parseCli: promote --to <state> <id> keeps the id as a positional', () => {
  const flagFirst = parseCli(['promote', '--to', 'supported', 'CLAIM-0123456789']);
  assert.equal(flagFirst.command, 'promote');
  assert.equal(flagFirst.flags.to, 'supported');
  assert.deepEqual(flagFirst.positionals, ['promote', 'CLAIM-0123456789']);
});

test('parseCli: --paths may be repeated', () => {
  const cli = parseCli(['ingest', '--paths', 'sources', '--paths', 'data']);
  assert.deepEqual(cli.flags.paths, ['sources', 'data']);
});

test('parseCli: an unknown flag is a usage error naming the flag and the allowed ones', () => {
  assert.throws(
    () => parseCli(['knowledge', 'list', '--typo', 'x']),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'USAGE');
      assert.equal(err.message, 'unknown option --typo for knowledge');
      assert.match(err.hint, /^allowed: /);
      assert.match(err.hint, /--type/);
      assert.match(err.hint, /--state/);
      assert.match(err.hint, /--query/);
      assert.match(err.hint, /--json/, 'the global flags are allowed too');
      return true;
    },
  );
});

test('parseCli: a flag that belongs to another command is still unknown here', () => {
  assert.throws(
    () => parseCli(['knowledge', 'list', '--rationale', 'x']),
    (err) => {
      assert.equal(err.message, 'unknown option --rationale for knowledge');
      return true;
    },
  );
  assert.doesNotThrow(() =>
    parseCli(['decide', 'propose', '--title', 't', '--rationale', 'because']),
  );
});

test('parseCli: every command accepts the global flags', () => {
  for (const command of Object.keys(COMMAND_OPTIONS)) {
    assert.doesNotThrow(
      () => parseCli([command, '--workspace', '/tmp/ws', '--actor', 'ada', '--json']),
      `${command} should accept the global flags`,
    );
  }
});

test('parseCli: an unknown command reports the command, not its flags', () => {
  const cli = parseCli(['frobnicate', '--not-a-real-flag', '--json']);
  assert.equal(cli.command, 'frobnicate');
  assert.equal(cli.flags.json, true);
});

test('parseCli: cite export --format', () => {
  const cli = parseCli(['cite', 'export', '--format', 'csl-json']);
  assert.equal(cli.command, 'cite');
  assert.equal(cli.sub, 'export');
  assert.equal(cli.flags.format, 'csl-json');
});

test('optionsFor: an unknown command has only the global options', () => {
  assert.deepEqual(
    Object.keys(optionsFor('frobnicate')).sort(),
    Object.keys(GLOBAL_OPTIONS).sort(),
  );
  assert.ok(Object.keys(optionsFor('link')).includes('to'));
});

test('parseCli: research keeps a quoted query as a positional and parses its flags', () => {
  const cli = parseCli([
    'research',
    'open science practices',
    '--question',
    'RQ-1',
    '--provider',
    'openalex, crossref',
    '--from',
    '2022',
    '--limit',
    '5',
    '--allow-network',
  ]);
  assert.equal(cli.command, 'research');
  assert.equal(cli.sub, 'open science practices');
  assert.equal(cli.flags.question, 'RQ-1');
  assert.deepEqual(cli.flags.provider, ['openalex', 'crossref']);
  assert.equal(cli.flags.from, '2022');
  assert.equal(cli.flags.limit, '5');
  assert.equal(cli.flags.allowNetwork, true);
});

test('parseCli: research list takes the shared state and question filters', () => {
  const cli = parseCli(['research', 'list', '--state', 'candidate', '--question', 'RQ-2']);
  assert.equal(cli.sub, 'list');
  assert.equal(cli.flags.state, 'candidate');
  assert.equal(cli.flags.question, 'RQ-2');
  assert.equal(cli.flags.allowNetwork, false);
});

test('parseCli: --allow-network is a usage error on any command but research', () => {
  assert.throws(
    () => parseCli(['status', '--allow-network']),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'USAGE');
      assert.match(err.message, /unknown option --allow-network for status/);
      return true;
    },
  );
});

test('parseCli: prose takes --file and --lang', () => {
  const cli = parseCli(['prose', '--file', 'draft.md', '--lang', 'es']);
  assert.equal(cli.command, 'prose');
  assert.equal(cli.flags.file, 'draft.md');
  assert.equal(cli.flags.lang, 'es');
});

// PRD §30c: an AI-detector score is not a quality metric, a test oracle or a skill input, so
// the flag that would ask for one is refused before any command sees it.
const DETECTOR_FLAGS = [
  '--detector',
  '--detector-target',
  '--detector=gptzero',
  '--humanize',
  '--humanize-to',
  '--humanize-to=0.2',
  '--no-detection',
  '--ai-detection-score',
];

for (const flag of DETECTOR_FLAGS) {
  test(`parseCli: ${flag} is refused as a policy violation, on any command`, () => {
    for (const argv of [
      ['prose', '--file', 'draft.md', flag],
      ['status', flag],
      ['frobnicate', flag],
    ]) {
      assert.throws(
        () => parseCli(argv),
        (err) => {
          assert.ok(err instanceof PhdudeError);
          assert.equal(err.code, 'POLICY');
          assert.equal(err.message, 'PhDude does not measure or target AI-detector scores');
          assert.match(err.hint, /PRD §30c/);
          return true;
        },
        `${argv.join(' ')} should be refused`,
      );
    }
  });
}

test('parseCli: the detector guard reads option names, not option values', () => {
  const cli = parseCli(['prose', '--file', 'notes-on-detection.md']);
  assert.equal(cli.flags.file, 'notes-on-detection.md');
  assert.equal(parseCli(['packs', 'detect']).sub, 'detect');
});

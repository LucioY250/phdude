import test from 'node:test';
import assert from 'node:assert/strict';
import analyzeCommand from '../../../src/adapters/cli/commands/analyze.js';

// A run with no exit code renders as "exit null" unless the renderers are told about signals,
// which reads as a run that returned nothing rather than one something killed.
const RUNS = [
  {
    at: '2026-09-07T10:00:00.000Z',
    exit: 0,
    duration_ms: 12,
    input_hashes: {},
    output_hashes: { 'analysis/out/x/results.json': 'a'.repeat(64) },
    results: ['RESULT-1111111111'],
  },
  {
    at: '2026-09-07T10:01:00.000Z',
    exit: null,
    signal: 'SIGKILL',
    duration_ms: 3,
    input_hashes: {},
    output_hashes: {},
    results: [],
    stderr_tail: 'Killed\n',
  },
  {
    at: '2026-09-07T10:02:00.000Z',
    exit: null,
    timed_out: true,
    signal: 'SIGTERM',
    duration_ms: 5,
    input_hashes: {},
    output_hashes: {},
    results: [],
  },
];

function analysis(runs) {
  return {
    id: 'ANALYSIS-0123456789',
    name: 'describe survey',
    runtime: 'node',
    script: 'analysis/describe.mjs',
    inputs: ['DATASET-0123456789'],
    outputs: { results: 'analysis/out/describe-survey/results.json', files: [] },
    params: {},
    runs,
    state: 'candidate',
  };
}

function ctxFor(sub, obj) {
  return {
    sub,
    positionals: ['analyze', sub, obj.id],
    flags: {},
    deps: {
      store: {
        readEntity: async (id) => (id === obj.id ? obj : null),
        listEntities: async () => [obj],
      },
    },
  };
}

test('analyze runs names the signal that ended a run instead of printing a null exit', async () => {
  const { text } = await analyzeCommand(ctxFor('runs', analysis(RUNS)));

  assert.match(text, /exit 0/);
  assert.match(text, /killed SIGKILL/);
  assert.match(text, /timed out/);
  assert.doesNotMatch(text, /exit null/);
  assert.match(text, /Killed/, 'the recorded stderr is printed');
});

test('analyze list reports a killed last run as killed, not as a failure with no code', async () => {
  const killedLast = await analyzeCommand(ctxFor('list', analysis(RUNS.slice(0, 2))));
  assert.match(killedLast.text, /killed by SIGKILL/);
  assert.doesNotMatch(killedLast.text, /exit null/);

  const timedOutLast = await analyzeCommand(ctxFor('list', analysis(RUNS)));
  assert.match(timedOutLast.text, /timed out/);

  const succeeded = await analyzeCommand(ctxFor('list', analysis(RUNS.slice(0, 1))));
  assert.match(succeeded.text, /ran 2026-09-07T10:00:00\.000Z/);

  const never = await analyzeCommand(ctxFor('list', analysis([])));
  assert.match(never.text, /never run/);
});

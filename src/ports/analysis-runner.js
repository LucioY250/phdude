/**
 * What a runner reports about one finished script. A run that failed is still a result: the
 * exit code, the timeout and the streams are what the analysis records, so only a runner that
 * could not start the process at all throws.
 * @typedef {object} RunResult
 * @property {number|null} exitCode - the process exit code; null when it was killed
 * @property {boolean} timedOut - true when `timeoutMs` elapsed and the process was killed
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} durationMs
 */

/**
 * @typedef {object} AnalysisRunner
 * @property {string} name
 * @property {(runtime: string) => Promise<boolean>} available - whether `runtime` can be run
 * @property {(opts: {runtime: string, script: string, args?: string[], cwd: string,
 *   env?: object, timeoutMs: number}) => Promise<RunResult>} run
 *
 * `runtime` is the executable to spawn - what `runtimeCommand(policy, analysis.runtime)`
 * resolved, never the logical name - and `script` is its first argument, resolved by the
 * runtime relative to `cwd`. `env` is the whole environment the script gets on top of the
 * runner's minimal set; nothing else of the parent's environment reaches it.
 */

/**
 * Registers the node:test cases every AnalysisRunner implementation must satisfy. `scriptsDir`
 * holds the suite's Node fixtures (`echo.mjs`, `fail.mjs`, `sleep.mjs`); the suite spawns the
 * Node binary running the tests, so it needs no runtime beyond the one CI already has.
 * @param {typeof import('node:test').test} test
 * @param {typeof import('node:assert/strict')} assert
 * @param {AnalysisRunner} runner
 * @param {{scriptsDir: string}} fixtures
 */
export function analysisRunnerContract(test, assert, runner, { scriptsDir }) {
  const name = runner.name;
  const node = process.execPath;
  const missing = 'phdude-no-such-runtime';

  test(`${name}: exposes the AnalysisRunner shape`, () => {
    assert.equal(typeof runner.name, 'string');
    assert.ok(runner.name.length > 0);
    assert.equal(typeof runner.available, 'function');
    assert.equal(typeof runner.run, 'function');
  });

  test(`${name}: a script that succeeds reports exit 0 and its stdout`, async () => {
    const result = await runner.run({
      runtime: node,
      script: 'echo.mjs',
      args: ['--key', 'mean weight'],
      cwd: scriptsDir,
      env: {},
      timeoutMs: 30_000,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.stderr, '');
    assert.ok(Number.isFinite(result.durationMs) && result.durationMs >= 0);
    assert.deepEqual(JSON.parse(result.stdout).args, ['--key', 'mean weight']);
  });

  test(`${name}: the script runs in the given cwd and sees only the environment it was handed`, async () => {
    process.env.PHDUDE_CONTRACT_LEAK = 'the parent environment stays in the parent';
    try {
      const result = await runner.run({
        runtime: node,
        script: 'echo.mjs',
        args: [],
        cwd: scriptsDir,
        env: { PHDUDE_ANALYSIS: 'ANALYSIS-0123456789' },
        timeoutMs: 30_000,
      });

      const reported = JSON.parse(result.stdout);
      assert.equal(reported.cwd, scriptsDir);
      assert.equal(reported.env.PHDUDE_ANALYSIS, 'ANALYSIS-0123456789');
      assert.equal(reported.env.PHDUDE_CONTRACT_LEAK, undefined);
    } finally {
      delete process.env.PHDUDE_CONTRACT_LEAK;
    }
  });

  test(`${name}: a non-zero exit is reported, not thrown`, async () => {
    const result = await runner.run({
      runtime: node,
      script: 'fail.mjs',
      args: [],
      cwd: scriptsDir,
      env: {},
      timeoutMs: 30_000,
    });

    assert.equal(result.exitCode, 3);
    assert.equal(result.timedOut, false);
    assert.match(result.stderr, /no such column/);
  });

  test(`${name}: a script that outruns its timeout is killed and reported as timed out`, async () => {
    const result = await runner.run({
      runtime: node,
      script: 'sleep.mjs',
      args: [],
      cwd: scriptsDir,
      env: {},
      timeoutMs: 250,
    });

    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, null);
  });

  test(`${name}: available() answers for a runtime that is present and one that is not`, async () => {
    assert.equal(await runner.available(node), true);
    assert.equal(await runner.available(missing), false);
  });

  test(`${name}: an unavailable runtime is a TOOL_MISSING error naming it`, async () => {
    await assert.rejects(
      runner.run({
        runtime: missing,
        script: 'echo.mjs',
        args: [],
        cwd: scriptsDir,
        env: {},
        timeoutMs: 30_000,
      }),
      (err) => {
        assert.equal(err.name, 'PhdudeError');
        assert.equal(err.code, 'TOOL_MISSING');
        assert.match(err.message, new RegExp(missing));
        assert.ok(typeof err.hint === 'string' && err.hint.length > 0, 'a TOOL_MISSING has a hint');
        return true;
      },
    );
  });
}

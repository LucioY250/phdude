import test from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analysisRunnerContract } from '../../src/ports/analysis-runner.js';
import { localRunner } from '../../src/adapters/execution/local.js';

// realpath, because the child reports the cwd it actually landed in and a temp or checkout path
// may be reached through a symlink.
const SCRIPTS_DIR = realpathSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'scripts'),
);

analysisRunnerContract(test, assert, localRunner, { scriptsDir: SCRIPTS_DIR });

// The other two runtimes the default policy names. CI has Node and nothing else is promised, so
// these say what they skipped rather than passing on an absent interpreter.
for (const [runtime, script] of [
  ['python3', 'hello.py'],
  ['Rscript', 'hello.R'],
]) {
  test(`localRunner: runs a ${runtime} script when the runtime is installed`, async (t) => {
    if (!(await localRunner.available(runtime))) {
      t.skip(`${runtime} is not installed on this machine`);
      return;
    }
    const result = await localRunner.run({
      runtime,
      script,
      args: ['from-the-contract'],
      cwd: SCRIPTS_DIR,
      env: {},
      timeoutMs: 30_000,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.match(result.stdout, /ok from-the-contract/);
  });
}

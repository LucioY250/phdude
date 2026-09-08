import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localRunner } from '../../../src/adapters/execution/local.js';
import { PhdudeError } from '../../../src/domain/errors.js';

const SCRIPTS_DIR = realpathSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'scripts'),
);
const POSIX = process.platform !== 'win32';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(check, withinMs) {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const value = await check();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) return null;
    await wait(25);
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('a script that traps SIGTERM is killed anyway and reported as timed out', async (t) => {
  if (!POSIX) return t.skip('process groups are a posix mechanism');

  const startedAt = Date.now();
  const result = await localRunner.run({
    runtime: process.execPath,
    script: 'trap.mjs',
    args: [],
    cwd: SCRIPTS_DIR,
    env: {},
    timeoutMs: 250,
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.equal(result.signal, 'SIGKILL', 'SIGTERM was trapped, so the escalation ended the run');
  assert.ok(Date.now() - startedAt < 10_000, 'the run ends within the grace period, not never');
});

test('a grandchild the script spawned dies with it when the timeout fires', async (t) => {
  if (!POSIX) return t.skip('process groups are a posix mechanism');

  const dir = await mkdtemp(join(tmpdir(), 'phdude-runner-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pidFile = join(dir, 'grandchild.pid');

  const result = await localRunner.run({
    runtime: process.execPath,
    script: 'spawner.mjs',
    args: [pidFile],
    cwd: SCRIPTS_DIR,
    env: {},
    timeoutMs: 500,
  });

  assert.equal(result.timedOut, true);
  const pid = Number(await readFile(pidFile, 'utf8'));
  assert.ok(Number.isInteger(pid) && pid > 0, 'the script recorded the grandchild it spawned');
  const dead = await until(() => !alive(pid) || undefined, 5_000);
  t.after(() => {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone, which is what the assertion above expects.
    }
  });
  assert.ok(dead, `the grandchild ${pid} outlived the timeout`);
});

test('a script killed by a signal of its own reports the signal, not an exit code', async (t) => {
  if (!POSIX) return t.skip('signals are a posix mechanism');

  const result = await localRunner.run({
    runtime: process.execPath,
    script: 'signal.mjs',
    args: [],
    cwd: SCRIPTS_DIR,
    env: {},
    timeoutMs: 30_000,
  });

  assert.equal(result.exitCode, null);
  assert.equal(result.timedOut, false);
  assert.equal(result.signal, 'SIGKILL');
});

test('a script that writes more than the buffer allows is a VALIDATION error', async () => {
  await assert.rejects(
    localRunner.run({
      runtime: process.execPath,
      script: 'flood.mjs',
      args: [],
      cwd: SCRIPTS_DIR,
      env: {},
      timeoutMs: 30_000,
    }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /wrote more than \d+ bytes/);
      assert.ok(typeof err.hint === 'string' && err.hint.length > 0);
      return true;
    },
  );
});

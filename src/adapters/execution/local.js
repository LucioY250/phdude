import { execFile, spawn } from 'node:child_process';
import { PhdudeError } from '../../domain/errors.js';

// Scripts get an environment PhDude built, not the one the researcher happens to be running in:
// an analysis reads its inputs from the workspace and nothing else, so an API key or a token in
// the parent shell must not be one `os.environ` away from a script the workspace declared.
const INHERITED = ['PATH', 'HOME', 'LANG'];

// `detached` puts the child in its own process group, which is what makes a group kill possible.
// `execFile` drops that option on the way to `spawn`, which is why `run` spawns for itself.
const POSIX = process.platform !== 'win32';

// Enough room for a chatty script's log, and a ceiling so a runaway one cannot exhaust memory.
const MAX_BUFFER = 10 * 1024 * 1024;

// How long a script gets to shut itself down after SIGTERM before the run is ended for it.
const KILL_GRACE_MS = 2_000;

function childEnv(env) {
  const inherited = {};
  for (const key of INHERITED) {
    if (process.env[key] !== undefined) inherited[key] = process.env[key];
  }
  return { ...inherited, ...env };
}

// A run is a process tree, not a pid: a script that shells out to R or a compiled tool leaves
// grandchildren, and signalling the group is the only way the timeout binds all of them. Windows
// has no process groups to signal, so there the direct child is the whole reach.
function killTree(child, signal) {
  try {
    if (POSIX) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The process is already gone, which is what the signal was for.
  }
}

/**
 * @param {string} runtime - the executable to probe
 * @returns {Promise<boolean>}
 */
async function available(runtime) {
  return new Promise((resolve) => {
    execFile(runtime, ['--version'], { timeout: 10_000 }, (err) => {
      // Only "there is no such executable" is an answer; an interpreter that dislikes
      // `--version`, or one too slow to answer, is still installed.
      resolve(err?.code !== 'ENOENT');
    });
  });
}

/**
 * Runs one script with an argument array and no shell, so nothing in a script path, an argument
 * or a policy value is ever interpreted as a command. The timeout is the only bound on a run, so
 * it ends the whole process group rather than one pid, and escalates past a trapped SIGTERM.
 * @param {{runtime: string, script: string, args?: string[], cwd: string, env?: object,
 *   timeoutMs: number}} opts
 * @returns {Promise<import('../../ports/analysis-runner.js').RunResult>}
 */
async function run({ runtime, script, args = [], cwd, env = {}, timeoutMs }) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let overflowed = false;
    let deadline = null;
    let escalation = null;

    const child = spawn(runtime, [script, ...args], {
      cwd,
      env: childEnv(env),
      detached: POSIX,
    });

    // Held as bytes and decoded once: a chunk boundary is not a character boundary.
    const collected = { stdout: [], stderr: [] };
    const written = { stdout: 0, stderr: 0 };
    for (const name of ['stdout', 'stderr']) {
      child[name].on('data', (chunk) => {
        written[name] += chunk.length;
        if (written[name] > MAX_BUFFER) {
          overflowed = true;
          killTree(child, 'SIGKILL');
          return;
        }
        collected[name].push(chunk);
      });
    }

    const done = () => {
      clearTimeout(deadline);
      clearTimeout(escalation);
    };

    child.on('error', (err) => {
      done();
      if (err.code === 'ENOENT') {
        reject(
          new PhdudeError(
            'TOOL_MISSING',
            `runtime not available: ${runtime}`,
            'install it, or point execution.runtimes at the executable in .phdude/research-policy.yaml',
          ),
        );
        return;
      }
      reject(err);
    });

    // `close`, not `exit`: the streams a grandchild is still holding open are part of the run.
    child.on('close', (code, signal) => {
      done();
      if (overflowed) {
        reject(
          new PhdudeError(
            'VALIDATION',
            `script wrote more than ${MAX_BUFFER} bytes to stdout or stderr: ${script}`,
            'write results to the files the analysis declares, not to the console',
          ),
        );
        return;
      }
      resolve({
        exitCode: timedOut ? null : code,
        timedOut,
        signal: signal ?? null,
        stdout: Buffer.concat(collected.stdout).toString('utf8'),
        stderr: Buffer.concat(collected.stderr).toString('utf8'),
        durationMs: Date.now() - startedAt,
      });
    });

    deadline = setTimeout(() => {
      timedOut = true;
      killTree(child, 'SIGTERM');
      escalation = setTimeout(() => killTree(child, 'SIGKILL'), KILL_GRACE_MS);
    }, timeoutMs);
  });
}

export const localRunner = { name: 'local', available, run };

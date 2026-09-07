import { execFile } from 'node:child_process';
import { PhdudeError } from '../../domain/errors.js';

// Scripts get an environment PhDude built, not the one the researcher happens to be running in:
// an analysis reads its inputs from the workspace and nothing else, so an API key or a token in
// the parent shell must not be one `os.environ` away from a script the workspace declared.
const INHERITED = ['PATH', 'HOME', 'LANG'];

// Enough room for a chatty script's log, and a ceiling so a runaway one cannot exhaust memory.
const MAX_BUFFER = 10 * 1024 * 1024;

function childEnv(env) {
  const inherited = {};
  for (const key of INHERITED) {
    if (process.env[key] !== undefined) inherited[key] = process.env[key];
  }
  return { ...inherited, ...env };
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
 * Runs one script through `execFile` with an argument array - never a shell, so nothing in a
 * script path, an argument or a policy value is ever interpreted as a command.
 * @param {{runtime: string, script: string, args?: string[], cwd: string, env?: object,
 *   timeoutMs: number}} opts
 * @returns {Promise<import('../../ports/analysis-runner.js').RunResult>}
 */
async function run({ runtime, script, args = [], cwd, env = {}, timeoutMs }) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    execFile(
      runtime,
      [script, ...args],
      { cwd, env: childEnv(env), timeout: timeoutMs, maxBuffer: MAX_BUFFER },
      (err, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;
        if (err?.code === 'ENOENT') {
          reject(
            new PhdudeError(
              'TOOL_MISSING',
              `runtime not available: ${runtime}`,
              'install it, or point execution.runtimes at the executable in .phdude/research-policy.yaml',
            ),
          );
          return;
        }
        if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          reject(
            new PhdudeError(
              'VALIDATION',
              `script wrote more than ${MAX_BUFFER} bytes to stdout or stderr: ${script}`,
              'write results to the files the analysis declares, not to the console',
            ),
          );
          return;
        }
        // The timeout is the only reason this adapter kills a process, so `killed` is what
        // tells the application the run ran out of time rather than failed on its own terms.
        const timedOut = err?.killed === true;
        let exitCode = 0;
        if (err) exitCode = typeof err.code === 'number' ? err.code : null;
        resolve({ exitCode: timedOut ? null : exitCode, timedOut, stdout, stderr, durationMs });
      },
    );
  });
}

export const localRunner = { name: 'local', available, run };

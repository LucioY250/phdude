import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function isInsideRepo(dir) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
    });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export async function initRepo(dir) {
  await execFileAsync('git', ['init', '-q'], { cwd: dir });
}

export async function userName(dir) {
  try {
    const { stdout } = await execFileAsync('git', ['config', 'user.name'], { cwd: dir });
    return stdout.trim();
  } catch {
    return null;
  }
}

// False when git is unavailable or this is not a repository: there is no history to protect,
// so there is nothing for a caller to refuse over.
export async function isDirty(dir) {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: dir });
    return stdout.trim() !== '';
  } catch {
    return false;
  }
}

export async function isAvailable() {
  try {
    await execFileAsync('git', ['--version']);
    return true;
  } catch {
    return false;
  }
}

export const gitAdapter = { isInsideRepo, initRepo, userName, isAvailable, isDirty };

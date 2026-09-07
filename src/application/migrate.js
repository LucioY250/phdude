import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PhdudeError } from '../domain/errors.js';
import { CURRENT_WORKSPACE_VERSION, planChain, workspaceVersionOf } from '../domain/versioning.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = join(PACKAGE_ROOT, 'migrations');

/**
 * Migration steps ship with the package, one `NNNN-<slug>.mjs` module each, so a step is added
 * by adding a file rather than by editing a registry.
 * @param {string} [dir]
 * @returns {Promise<object[]>}
 */
export async function loadMigrations(dir = MIGRATIONS_DIR) {
  let files;
  try {
    files = await readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const steps = [];
  for (const file of files.filter((f) => f.endsWith('.mjs')).sort()) {
    const module = await import(pathToFileURL(join(dir, file)).href);
    const step = module.default;
    if (
      step === undefined ||
      step === null ||
      !Number.isInteger(step.from) ||
      !Number.isInteger(step.to) ||
      typeof step.describe !== 'function' ||
      typeof step.preview !== 'function' ||
      typeof step.apply !== 'function'
    ) {
      throw new PhdudeError(
        'VALIDATION',
        `malformed migration module ${file}`,
        'reinstall phdude; its migrations directory is corrupt',
      );
    }
    steps.push(step);
  }
  return steps;
}

/**
 * @param {{store: object, git: object, clock: () => string, actor: object,
 *   loadSteps?: () => Promise<object[]>}} deps
 * @param {{dryRun?: boolean, force?: boolean}} opts
 * @returns {Promise<{from: number, to: number, dryRun: boolean, applied: boolean,
 *   steps: {from: number, to: number, description: string, changed: string[]}[]}>}
 */
export async function migrate(
  { store, git, clock, actor, loadSteps = loadMigrations },
  { dryRun = false, force = false } = {},
) {
  const project = await store.readProject();
  if (project === null) {
    throw new PhdudeError('USAGE', 'not a PhDude workspace', 'run phdude init');
  }

  const from = workspaceVersionOf(project);
  const to = CURRENT_WORKSPACE_VERSION;
  const chain = planChain(await loadSteps(), from, to);
  if (chain.length === 0) return { from, to, dryRun, applied: false, steps: [] };

  // git is the backup: a migration rewrites files in place, and a researcher who cannot diff
  // the result against a clean tree cannot undo it. A dry run writes nothing, so it stays
  // available - it is how you decide whether the commit is worth making.
  if (!dryRun && !force && (await git.isDirty(store.root))) {
    throw new PhdudeError(
      'POLICY',
      'working tree has uncommitted changes',
      'commit or stash first, or pass --force',
    );
  }

  const steps = [];
  for (const step of chain) {
    const description = step.describe();

    if (dryRun) {
      steps.push({ from: step.from, to: step.to, description, changed: await step.preview(store) });
      continue;
    }

    const { changed } = await step.apply(store);
    // A step is free to write the version itself (0001 does, as part of the file it rewrites);
    // this is the backstop that keeps the chain advancing when one does not.
    const current = await store.readProject();
    if (workspaceVersionOf(current) !== step.to) {
      await store.writeProject({ ...current, workspace_version: step.to });
    }
    await store.appendEvent({
      ts: clock(),
      op: 'migrate',
      actor,
      ids: [],
      summary: `${step.from} → ${step.to}: ${description}`,
    });
    steps.push({ from: step.from, to: step.to, description, changed });
  }

  return { from, to, dryRun, applied: !dryRun, steps };
}

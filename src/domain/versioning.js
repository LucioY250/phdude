import { PhdudeError } from './errors.js';

// The workspace, not the individual object, carries the version. Object schemas stay at
// `version: 1` while every field added since v0.1 is additive with a default, so a reader only
// has to ask one question - "is this workspace current?" - before trusting the fields it expects.
export const CURRENT_WORKSPACE_VERSION = 4;

/**
 * @param {object|null} project - a parsed phdude.yaml
 * @returns {number} the workspace version; v0.1 workspaces lack the field and are version 1
 */
export function workspaceVersionOf(project) {
  const version = project?.workspace_version;
  return Number.isInteger(version) ? version : 1;
}

/**
 * @param {object|null} project
 * @returns {boolean}
 */
export function needsMigration(project) {
  return workspaceVersionOf(project) < CURRENT_WORKSPACE_VERSION;
}

/**
 * A workspace written by a newer PhDude carries fields this build does not know about, so
 * writing into it would mix shapes exactly the way an un-migrated workspace does - the other
 * end of the same problem, and unfixable from here.
 * @param {object|null} project
 * @returns {boolean}
 */
export function isNewerThanRuntime(project) {
  return workspaceVersionOf(project) > CURRENT_WORKSPACE_VERSION;
}

/**
 * @param {{from: number, to: number}[]} steps - the discovered migration modules, any order
 * @param {number} from
 * @param {number} to
 * @returns {{from: number, to: number}[]} the steps to run, in order
 */
export function planChain(steps, from, to) {
  if (from > to) {
    throw new PhdudeError(
      'VALIDATION',
      `workspace version ${from} is newer than ${to}`,
      'upgrade phdude',
    );
  }

  const byFrom = new Map(steps.map((step) => [step.from, step]));
  const chain = [];
  let at = from;
  while (at < to) {
    const step = byFrom.get(at);
    if (!step) {
      throw new PhdudeError(
        'VALIDATION',
        `no migration from workspace version ${at}`,
        'reinstall phdude; its migrations directory is incomplete',
      );
    }
    if (step.to <= at) {
      throw new PhdudeError(
        'VALIDATION',
        `migration ${step.from} → ${step.to} does not advance the workspace version`,
        'reinstall phdude; its migrations directory is corrupt',
      );
    }
    chain.push(step);
    at = step.to;
  }
  return chain;
}

import { PhdudeError } from '../../domain/errors.js';
import { claudeCodeHost } from './claude-code.js';
import { codexHost } from './codex.js';

// The agent hosts PhDude can write for, in one place: `init` names them on the command line and
// records the choice in `phdude.yaml`, and every later command that has to refresh AGENTS.md
// reads that record rather than asking again.
export const HOSTS = { 'claude-code': claudeCodeHost, codex: codexHost };

export const DEFAULT_AGENTS = ['claude-code', 'codex'];

/**
 * @param {string[]} names
 * @returns {object[]} the hosts, in the order named
 * @throws {PhdudeError} USAGE, when a name is not a host PhDude knows
 */
export function hostsFor(names) {
  return names.map((name) => {
    const host = HOSTS[name];
    if (!host) {
      throw new PhdudeError(
        'USAGE',
        `unknown agent host: ${name}`,
        `known hosts: ${Object.keys(HOSTS).join(', ')}`,
      );
    }
    return host;
  });
}

/**
 * The hosts a workspace recorded, ignoring any it names that this PhDude does not know. Used
 * where refreshing the agent files is a side effect of another command: a workspace written by a
 * later PhDude must not make `phdude skills install` fail after it has already installed.
 * @param {string[]|null|undefined} names - `phdude.yaml`'s `agents`
 * @returns {object[]}
 */
export function knownHosts(names) {
  return (names ?? []).filter((name) => Object.hasOwn(HOSTS, name)).map((name) => HOSTS[name]);
}

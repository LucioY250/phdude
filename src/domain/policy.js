import { PhdudeError } from './errors.js';

// Nothing leaves the machine unless the workspace says so (PRD S71): the policy is read as
// closed whenever it is absent, unreadable or says anything other than a literal true.
export const ENABLE_NETWORK = 'set network.enabled: true in .phdude/research-policy.yaml';

const NETWORK_HINT = `${ENABLE_NETWORK} or pass --allow-network`;

// Running a script is the second thing the workspace holds shut (PRD S75), and for the same
// reason: a declared analysis is code the researcher meant to run, not code that runs because
// it is there. Same shape as the network switch, same "a literal true or nothing" reading.
export const ENABLE_EXECUTION = 'set execution.enabled: true in .phdude/research-policy.yaml';

const EXECUTION_HINT = `${ENABLE_EXECUTION} or pass --allow-exec`;

export const DEFAULT_RUNTIMES = { node: 'node', python3: 'python3', Rscript: 'Rscript' };

export const DEFAULT_EXECUTION_TIMEOUT_SECONDS = 600;

export const DEFAULT_PROVIDERS = ['openalex', 'crossref', 'arxiv'];

export const DEFAULT_FILTERS = {
  from: null,
  languages: ['en'],
  peerReviewed: 'preferred',
  preprintsRequireApproval: true,
  limit: 20,
  staleAfterDays: 180,
};

const PEER_REVIEWED = ['preferred', 'required', 'any'];

/**
 * @param {object|null} policy - the parsed `.phdude/research-policy.yaml`
 * @param {{allowNetwork?: boolean}} flags - the flags of the command asking
 * @returns {boolean}
 */
export function networkAllowed(policy, flags) {
  return flags?.allowNetwork === true || policy?.network?.enabled === true;
}

/**
 * @param {object|null} policy
 * @param {{allowNetwork?: boolean}} flags
 */
export function assertNetworkAllowed(policy, flags) {
  if (!networkAllowed(policy, flags)) {
    throw new PhdudeError('POLICY', 'network access is disabled', NETWORK_HINT);
  }
}

/**
 * @param {object|null} policy - the parsed `.phdude/research-policy.yaml`
 * @param {{allowExec?: boolean}} flags - the flags of the command asking
 * @returns {boolean}
 */
export function executionAllowed(policy, flags) {
  return flags?.allowExec === true || policy?.execution?.enabled === true;
}

/**
 * @param {object|null} policy
 * @param {{allowExec?: boolean}} flags
 */
export function assertExecutionAllowed(policy, flags) {
  if (!executionAllowed(policy, flags)) {
    throw new PhdudeError('POLICY', 'script execution is disabled', EXECUTION_HINT);
  }
}

/**
 * The executable a runtime name resolves to. `execution.runtimes` is the whole registry of what
 * this workspace may run: a runtime it does not name is unknown, so a typo in an analysis is a
 * validation error rather than a spawn of something nobody declared.
 * @param {object|null} policy
 * @param {string} runtime - the `runtime` field of an analysis or a figure generator
 * @returns {string}
 */
export function runtimeCommand(policy, runtime) {
  const configured = policy?.execution?.runtimes;
  const commands = {
    ...DEFAULT_RUNTIMES,
    ...(configured !== null && typeof configured === 'object' && !Array.isArray(configured)
      ? configured
      : {}),
  };
  const command = commands[runtime];
  if (typeof command !== 'string' || command.trim() === '') {
    const known = Object.keys(commands)
      .sort((a, b) => a.localeCompare(b))
      .join(', ');
    throw new PhdudeError(
      'VALIDATION',
      `unknown runtime: ${runtime}`,
      `name it under execution.runtimes in .phdude/research-policy.yaml (known: ${known})`,
    );
  }
  return command.trim();
}

/**
 * @param {object|null} policy
 * @returns {number} how long a script may run, in milliseconds
 */
export function executionTimeoutMs(policy) {
  const seconds =
    positiveInteger(policy?.execution?.timeout_seconds) ?? DEFAULT_EXECUTION_TIMEOUT_SECONDS;
  return seconds * 1000;
}

/**
 * The ordered provider list the workspace wants searched.
 * @param {object|null} policy
 * @returns {string[]}
 */
export function providerNames(policy) {
  if (!Array.isArray(policy?.providers)) return [...DEFAULT_PROVIDERS];
  const names = [];
  for (const entry of policy.providers) {
    if (typeof entry !== 'string') continue;
    const name = entry.trim().toLowerCase();
    if (name && !names.includes(name)) names.push(name);
  }
  return names.length > 0 ? names : [...DEFAULT_PROVIDERS];
}

/**
 * The research preferences a search applies, with every unusable value replaced by its default
 * rather than passed on to a provider.
 * @param {object|null} policy
 * @returns {{from: number|null, languages: string[], peerReviewed: string,
 *   preprintsRequireApproval: boolean, limit: number, staleAfterDays: number}}
 */
export function researchFilters(policy) {
  const research = policy?.research ?? {};
  const languages = Array.isArray(research.languages)
    ? research.languages.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.trim())
    : [];

  return {
    from: positiveInteger(research.year_range?.from) ?? DEFAULT_FILTERS.from,
    languages: languages.length > 0 ? languages : [...DEFAULT_FILTERS.languages],
    peerReviewed: PEER_REVIEWED.includes(research.peer_reviewed)
      ? research.peer_reviewed
      : DEFAULT_FILTERS.peerReviewed,
    preprintsRequireApproval:
      typeof research.preprints?.require_approval === 'boolean'
        ? research.preprints.require_approval
        : DEFAULT_FILTERS.preprintsRequireApproval,
    limit: positiveInteger(research.limit) ?? DEFAULT_FILTERS.limit,
    staleAfterDays:
      positiveInteger(research.freshness?.stale_after_days) ?? DEFAULT_FILTERS.staleAfterDays,
  };
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

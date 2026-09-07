import { dirname, join } from 'node:path';
import { PhdudeError } from '../domain/errors.js';

export const SKILL_POLICY_HINT = 'set skills.allow_network: true in .phdude/research-policy.yaml';

export const SKILL_EXECUTION_POLICY_HINT =
  'set skills.allow_execution: true in .phdude/research-policy.yaml';

// The two permissions a skill can ask for that the workspace holds shut by default, each with
// the setting that opens it. Checked in order, so a skill that wants both is reported against
// the first one the policy has not granted.
const PERMISSION_RULES = [
  {
    permission: 'network',
    setting: 'allow_network',
    asks: 'network access',
    hint: SKILL_POLICY_HINT,
  },
  {
    permission: 'execution',
    setting: 'allow_execution',
    asks: 'script execution',
    hint: SKILL_EXECUTION_POLICY_HINT,
  },
];

/**
 * Whether a skill's declared permissions are at odds with the workspace policy. A skill that
 * asks for neither, or a missing/absent policy that defaults closed, is never a violation.
 * `packs apply` turns this into a refusal; `init` withholds the skill and `doctor` only
 * reports it.
 * @param {{name: string, contract: object}} skill
 * @param {object|null} policy - the parsed `.phdude/research-policy.yaml`
 * @returns {{reason: string, hint: string}|null} null when there is nothing to report
 */
export function skillPolicyViolation(skill, policy) {
  for (const rule of PERMISSION_RULES) {
    if (skill.contract.permissions[rule.permission] !== 'allowed') continue;
    if (policy?.skills?.[rule.setting] === true) continue;
    return { reason: `skill ${skill.name} requests ${rule.asks}`, hint: rule.hint };
  }
  return null;
}

/**
 * Refuses a skill that declares `permissions.network: allowed` or `permissions.execution:
 * allowed` unless the workspace policy opts in. A skill without those permissions, or a
 * missing/absent policy that defaults closed, always passes.
 * @param {{name: string, contract: object}} skill
 * @param {object|null} policy - the parsed `.phdude/research-policy.yaml`
 */
export function assertSkillPolicyOk(skill, policy) {
  const violation = skillPolicyViolation(skill, policy);
  if (violation) throw new PhdudeError('POLICY', violation.reason, violation.hint);
}

const POLICY_PATH = join('.phdude', 'research-policy.yaml');

/**
 * `discoverSkills` and `skillsDir` are injected (see adapters/skills/loader.js and
 * adapters/agents/shared.js's DEFAULT_SKILLS_DIR) so this application module never imports an
 * adapter directly.
 *
 * Diagnostic, so nothing here throws: a skill that fails to load costs one warning and its own
 * row, never the rest of the report, and a skill whose network permission the policy has not
 * allowed is reported rather than refused.
 * @param {{store: object, loadPacks: () => Promise<object[]>,
 *   discoverSkills: (roots: {dir: string, source: string}[], options?: object) => Promise<object[]>,
 *   skillsDir: string}} deps
 * @returns {Promise<{skills: {name: string, source: string, permissions: object, reads: string[],
 *   writes: string[], warnings: string[]}[], warnings: string[]}>}
 */
export async function listSkills({ store, loadPacks, discoverSkills, skillsDir }) {
  const warnings = [];
  const onError = ({ name, source, error }) =>
    warnings.push(`skill ${name} (${source}) could not be loaded: ${error.message}`);

  // The shipped content, read before anything else, so a workspace copy can be recognised as
  // one. Failures are silent here because the same root is discovered again below, where they
  // are reported once.
  const shipped = await discoverSkills([{ dir: skillsDir, source: 'core' }], { onError: () => {} });
  const shippedText = new Map(shipped.map((skill) => [skill.name, skill.text]));

  const roots = [{ dir: skillsDir, source: 'core' }];

  const packs = await loadPacks();
  for (const pack of packs) {
    for (const skillPath of pack.skillPaths) {
      roots.push({ dir: dirname(skillPath), source: `pack:${pack.name}` });
    }
  }

  roots.push({ dir: join(store.root, '.phdude', 'skills'), source: 'workspace' });

  // A policy this cannot parse reads as closed, like a missing one. Its own caller, `doctor`,
  // reads the same file and reports that it is unreadable, so raising here would only turn one
  // clear line into an unrelated "skills could not be loaded".
  let policy = null;
  try {
    policy = await store.readYaml(POLICY_PATH);
  } catch {
    policy = null;
  }
  const skills = await discoverSkills(roots, { onError });

  return {
    skills: skills.map((skill) => {
      const violation = skillPolicyViolation(skill, policy);
      if (violation) warnings.push(`${violation.reason}; ${violation.hint}`);
      return {
        name: skill.name,
        // `init` copies the shipped skills into `.phdude/skills/`, so discovery finds every core
        // skill under the workspace root and would call all of them "workspace". Only a copy
        // that differs from the shipped file is one.
        source:
          skill.source === 'workspace' && shippedText.get(skill.name) === skill.text
            ? 'core'
            : skill.source,
        permissions: skill.contract.permissions,
        reads: skill.contract.reads,
        writes: skill.contract.writes,
        warnings: skill.warnings,
      };
    }),
    warnings,
  };
}

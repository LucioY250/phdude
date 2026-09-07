import { dirname, join } from 'node:path';
import { PhdudeError } from '../domain/errors.js';

const POLICY_HINT = 'set skills.allow_network: true in .phdude/research-policy.yaml';

/**
 * Whether a skill's declared network permission is at odds with the workspace policy. A skill
 * without that permission, or a missing/absent policy that defaults closed, is never a
 * violation. `packs apply` and `init` turn this into a refusal; `doctor` only reports it.
 * @param {{name: string, contract: object}} skill
 * @param {object|null} policy - the parsed `.phdude/research-policy.yaml`
 * @returns {string|null} the message, or null when there is nothing to report
 */
export function skillPolicyViolation(skill, policy) {
  if (skill.contract.permissions.network !== 'allowed') return null;
  if (policy?.skills?.allow_network === true) return null;
  return `skill ${skill.name} requests network access`;
}

/**
 * Refuses a skill that declares `permissions.network: allowed` unless the workspace policy
 * opts in. A skill without that permission, or a missing/absent policy that defaults closed,
 * always passes.
 * @param {{name: string, contract: object}} skill
 * @param {object|null} policy - the parsed `.phdude/research-policy.yaml`
 */
export function assertSkillPolicyOk(skill, policy) {
  const message = skillPolicyViolation(skill, policy);
  if (message) throw new PhdudeError('POLICY', message, POLICY_HINT);
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

  const policy = await store.readYaml(POLICY_PATH);
  const skills = await discoverSkills(roots, { onError });

  return {
    skills: skills.map((skill) => {
      const violation = skillPolicyViolation(skill, policy);
      if (violation) warnings.push(`${violation}; ${POLICY_HINT}`);
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

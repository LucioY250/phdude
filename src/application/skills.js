import { dirname, join } from 'node:path';
import { PhdudeError } from '../domain/errors.js';

/**
 * Refuses a skill that declares `permissions.network: allowed` unless the workspace policy
 * opts in. A skill without that permission, or a missing/absent policy that defaults closed,
 * always passes.
 * @param {{name: string, contract: object}} skill
 * @param {object|null} policy - the parsed `.phdude/research-policy.yaml`
 */
export function assertSkillPolicyOk(skill, policy) {
  if (skill.contract.permissions.network !== 'allowed') return;
  if (policy?.skills?.allow_network === true) return;
  throw new PhdudeError(
    'POLICY',
    `skill ${skill.name} requests network access`,
    'set skills.allow_network: true in .phdude/research-policy.yaml',
  );
}

/**
 * `discoverSkills` and `skillsDir` are injected (see adapters/skills/loader.js and
 * adapters/agents/shared.js's DEFAULT_SKILLS_DIR) so this application module never imports an
 * adapter directly.
 * @param {{store: object, loadPacks: () => Promise<object[]>,
 *   discoverSkills: (roots: {dir: string, source: string}[]) => Promise<object[]>,
 *   skillsDir: string}} deps
 * @returns {Promise<{name: string, source: string, permissions: object, reads: string[],
 *   writes: string[], warnings: string[]}[]>}
 */
export async function listSkills({ store, loadPacks, discoverSkills, skillsDir }) {
  const roots = [{ dir: skillsDir, source: 'core' }];

  const packs = await loadPacks();
  for (const pack of packs) {
    for (const skillPath of pack.skillPaths) {
      roots.push({ dir: dirname(skillPath), source: `pack:${pack.name}` });
    }
  }

  roots.push({ dir: join(store.root, '.phdude', 'skills'), source: 'workspace' });

  const skills = await discoverSkills(roots);
  return skills.map((skill) => ({
    name: skill.name,
    source: skill.source,
    permissions: skill.contract.permissions,
    reads: skill.contract.reads,
    writes: skill.contract.writes,
    warnings: skill.warnings,
  }));
}

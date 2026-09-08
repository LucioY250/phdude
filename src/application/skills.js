import { dirname, join } from 'node:path';
import { PhdudeError } from '../domain/errors.js';
import { assertNetworkAllowed } from '../domain/policy.js';
import {
  assertNoDetectorPurpose,
  classifySkillSource,
  emptyLock,
  findLocked,
  removeLocked,
  skillTreeHash,
  SKILL_NAME_RE,
  upsertLocked,
} from '../domain/skills.js';
import { assertUpToDate } from './guard.js';

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

const SKILLS_DIR = join('.phdude', 'skills');

async function requireProject(store) {
  const project = await store.readProject();
  if (project === null) {
    throw new PhdudeError('USAGE', 'not a PhDude workspace', 'run phdude init');
  }
  assertUpToDate(project);
  return project;
}

// A policy this cannot parse reads as closed, exactly as it does for `listSkills`: an install
// that fell back to the built-in defaults would grant a permission the workspace never wrote.
async function readPolicy(store) {
  try {
    return await store.readYaml(POLICY_PATH);
  } catch {
    return null;
  }
}

// The names PhDude ships. `init` mirrors each of them into `.phdude/skills/`, so installing over
// one would be undone by the next `init`, and removing one would be silently reinstalled.
async function shippedNames(discoverSkills, skillsDir) {
  const shipped = await discoverSkills([{ dir: skillsDir, source: 'core' }], { onError: () => {} });
  return new Set(shipped.map((skill) => skill.name));
}

/**
 * Installs an external skill from a directory on this machine or from an https repository, under
 * the same permission gating as a shipped one: a skill asking for network or execution the
 * workspace policy has not opened is refused rather than installed and then withheld. The bytes
 * are copied; nothing in the skill is ever run (spec §3.5).
 *
 * The tree is staged outside the workspace and validated there before a single byte lands in
 * `.phdude/skills/`, so a skill that fails its contract leaves nothing behind.
 * @param {{store: object, discoverSkills: Function, skillsDir: string, loadSkill: Function,
 *   readSkillSource: Function, writeSkillTree: Function, cloneSkill: Function,
 *   tempDir: () => Promise<string>, removeDir: (dir: string) => Promise<void>,
 *   clock: () => string, actor: object}} deps
 * @param {string} source - an absolute directory path, or an https git URL
 * @param {{allowNetwork?: boolean, force?: boolean}} options
 * @returns {Promise<{name: string, source: string, hash: string, installed_at: string,
 *   replaced: boolean, files: number}>}
 */
export async function install(
  {
    store,
    discoverSkills,
    skillsDir,
    loadSkill,
    readSkillSource,
    writeSkillTree,
    cloneSkill,
    tempDir,
    removeDir,
    clock,
    actor,
  },
  source,
  { allowNetwork = false, force = false } = {},
) {
  await requireProject(store);
  const classified = classifySkillSource(source);
  const policy = await readPolicy(store);

  const work = await tempDir();
  try {
    let dir = classified.kind === 'path' ? classified.path : join(work, 'clone');
    if (classified.kind === 'git') {
      assertNetworkAllowed(policy, { allowNetwork });
      await cloneSkill(classified.url, dir);
    }
    const recorded = classified.kind === 'git' ? classified.url : classified.path;

    const { files, name, description } = await readSkillSource(dir);
    if (!SKILL_NAME_RE.test(String(name ?? ''))) {
      throw new PhdudeError(
        'VALIDATION',
        `skill name missing or invalid: ${name ?? '(none)'}`,
        'a skill declares `name: <lowercase-words-joined-by-dashes>` in its SKILL.md front matter',
      );
    }
    assertNoDetectorPurpose(name, [name, description]);

    if ((await shippedNames(discoverSkills, skillsDir)).has(name)) {
      throw new PhdudeError(
        'VALIDATION',
        `${name} is a skill PhDude ships`,
        'phdude init keeps the shipped skills in step; install an external skill under another name',
      );
    }

    const rel = join(SKILLS_DIR, name);
    const replaced = await store.exists(rel);
    if (replaced && !force) {
      throw new PhdudeError(
        'VALIDATION',
        `skill ${name} is already installed`,
        'pass --force to replace it, or phdude skills remove it first',
      );
    }

    // Staged under its own name so `loadSkill` sees the directory it will live in: the loader
    // refuses a skill whose front matter name does not match its directory, and a clone's
    // temporary directory never would.
    const staged = join(work, name);
    await writeSkillTree(files, staged);
    assertSkillPolicyOk(await loadSkill(staged), policy);

    if (replaced) await removeDir(join(store.root, rel));
    for (const file of files) await store.writeBytesAtomic(join(rel, file.path), file.bytes);

    const ts = clock();
    const entry = { name, source: recorded, hash: skillTreeHash(files), installed_at: ts };
    await store.writeSkillsLock(upsertLocked((await store.readSkillsLock()) ?? emptyLock(), entry));
    await store.appendEvent({
      ts,
      op: 'skills',
      actor,
      ids: [],
      summary: `installed ${name} from ${recorded}`,
    });

    return { ...entry, replaced, files: files.length };
  } finally {
    await removeDir(work);
  }
}

/**
 * @param {{store: object, discoverSkills: Function, skillsDir: string,
 *   removeDir: (dir: string) => Promise<void>, clock: () => string, actor: object}} deps
 * @param {string} name
 * @returns {Promise<{name: string, source: string|null}>}
 */
export async function remove({ store, discoverSkills, skillsDir, removeDir, clock, actor }, name) {
  await requireProject(store);

  if ((await shippedNames(discoverSkills, skillsDir)).has(name)) {
    throw new PhdudeError(
      'VALIDATION',
      `${name} is a skill PhDude ships`,
      'the shipped skills are mirrored by phdude init; only an installed external skill can be removed',
    );
  }

  const rel = join(SKILLS_DIR, name);
  if (!(await store.exists(rel))) {
    throw new PhdudeError('USAGE', `no skill named ${name} is installed`, 'phdude skills list');
  }

  const lock = await store.readSkillsLock();
  const entry = findLocked(lock, name);

  await removeDir(join(store.root, rel));
  if (entry !== null) await store.writeSkillsLock(removeLocked(lock, name));
  await store.appendEvent({
    ts: clock(),
    op: 'skills',
    actor,
    ids: [],
    summary: `removed ${name}`,
  });

  return { name, source: entry?.source ?? null };
}

/**
 * What the lock file says the workspace installed, checked against what is on disk. Diagnostic,
 * so nothing here throws: a lock entry whose files are gone or no longer hash to what was
 * recorded is a warning and a row, never the reason the report is empty.
 * @param {{store: object, readSkillSource: Function}} deps
 * @returns {Promise<{skills: object[], warnings: string[]}>}
 */
export async function externalSkills({ store, readSkillSource }) {
  const warnings = [];
  let lock;
  try {
    lock = await store.readSkillsLock();
  } catch (err) {
    warnings.push(`skills-lock.yaml could not be read: ${err.message}`);
    return { skills: [], warnings };
  }

  const skills = [];
  for (const entry of lock?.skills ?? []) {
    const rel = join(SKILLS_DIR, entry.name);
    if (!(await store.exists(rel))) {
      warnings.push(
        `skill ${entry.name} is locked to ${entry.source} but is not installed; run phdude skills remove ${entry.name}`,
      );
      skills.push({ ...entry, present: false, drifted: false });
      continue;
    }
    try {
      const { files } = await readSkillSource(join(store.root, rel));
      const drifted = skillTreeHash(files) !== entry.hash;
      if (drifted) {
        warnings.push(
          `skill ${entry.name} no longer matches the hash in .phdude/skills-lock.yaml; it was edited after it was installed`,
        );
      }
      skills.push({ ...entry, present: true, drifted });
    } catch (err) {
      warnings.push(`skill ${entry.name} could not be hashed: ${err.message}`);
      skills.push({ ...entry, present: true, drifted: false });
    }
  }
  return { skills, warnings };
}

/**
 * Every skill this workspace would load, with where it came from: `core` for the shipped set,
 * `pack:<name>` for a pack's, `workspace` for anything under `.phdude/skills/`. The external
 * ones additionally carry the source they were installed from and when.
 * @param {{store: object, loadPacks: Function, discoverSkills: Function, skillsDir: string,
 *   readSkillSource: Function}} deps
 * @returns {Promise<{skills: object[], warnings: string[]}>}
 */
export async function list({ store, loadPacks, discoverSkills, skillsDir, readSkillSource }) {
  const listed = await listSkills({ store, loadPacks, discoverSkills, skillsDir });
  const external = await externalSkills({ store, readSkillSource });
  const locked = new Map(external.skills.map((entry) => [entry.name, entry]));

  return {
    skills: listed.skills.map((skill) => {
      const entry = locked.get(skill.name) ?? null;
      return {
        ...skill,
        external: entry !== null,
        origin: entry?.source ?? null,
        installedAt: entry?.installed_at ?? null,
        drifted: entry?.drifted ?? false,
      };
    }),
    warnings: [...listed.warnings, ...external.warnings],
  };
}

import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { validate } from '../../schemas/index.js';
import { PhdudeError } from '../../domain/errors.js';
import { parseFrontMatter } from '../agents/shared.js';

const DEFAULT_CONTRACT = {
  version: 1,
  reads: [],
  writes: [],
  permissions: { network: 'none', workspace: ['read'] },
};

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Loads and validates one `SKILL.md`. A skill with no `phdude:` block gets the least-privilege
 * default contract and a warning, never a hard failure - a plain Agent Skill must still load.
 * `text` is the file verbatim, so a caller can tell a workspace copy of a shipped skill from an
 * edited one without reading the file a second time.
 * @param {string} dir - the skill's directory (its basename is the skill name)
 * @returns {Promise<{name: string, description: string, contract: object, path: string,
 *   text: string, warnings: string[]}>}
 */
export async function loadSkill(dir) {
  const name = basename(dir);
  const path = join(dir, 'SKILL.md');
  const text = await readFile(path, 'utf8');
  const { meta } = parseFrontMatter(text);

  if (meta?.name !== name) {
    throw new PhdudeError(
      'VALIDATION',
      `skill ${name}: front matter name "${meta?.name}" does not match its directory`,
      'set the SKILL.md front matter `name` to match the skill directory',
    );
  }

  const warnings = [];
  let contract = meta.phdude;
  if (contract === undefined) {
    contract = DEFAULT_CONTRACT;
    warnings.push(`skill ${name}: no phdude contract, least privilege assumed`);
  } else {
    const result = validate('skill', contract);
    if (!result.ok) {
      throw new PhdudeError(
        'VALIDATION',
        `skill ${name}: ${result.errors.join('; ')}`,
        'fix the phdude: block in SKILL.md',
      );
    }
  }

  return { name, description: meta.description ?? '', contract, path, text, warnings };
}

async function skillDirsUnder(dir) {
  if (await exists(join(dir, 'SKILL.md'))) return [dir];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sub = join(dir, entry.name);
    if (await exists(join(sub, 'SKILL.md'))) dirs.push(sub);
  }
  return dirs;
}

/**
 * Discovers skills across `roots` in order; a later root's skill overrides an earlier one with
 * the same name. Each root is either a single skill directory (contains `SKILL.md` directly)
 * or a directory of skill directories (e.g. `skills/`, `.phdude/skills/`).
 *
 * One unloadable skill aborts the whole discovery by default, which is what `init` and
 * `packs apply` want: neither may adopt half a set. `onError` opts out of that - the failing
 * skill is reported and skipped, and the rest are still returned - which is what `doctor`
 * wants, since a report that vanishes because one file is broken is the report you needed.
 * @param {{dir: string, source: string}[]} roots
 * @param {{onError?: (failure: {name: string, source: string, dir: string, error: Error}) => void}} [options]
 * @returns {Promise<object[]>} skills sorted by name, each carrying its root's `source`
 */
export async function discoverSkills(roots, { onError } = {}) {
  const byName = new Map();
  for (const { dir, source } of roots) {
    for (const skillDir of await skillDirsUnder(dir)) {
      let skill;
      try {
        skill = await loadSkill(skillDir);
      } catch (error) {
        if (!onError) throw error;
        onError({ name: basename(skillDir), source, dir: skillDir, error });
        continue;
      }
      byName.set(skill.name, { ...skill, source });
    }
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

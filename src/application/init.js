import { readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRENT_WORKSPACE_VERSION } from '../domain/versioning.js';
import { skillPolicyViolation } from './skills.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULTS_DIR = join(PACKAGE_ROOT, 'defaults');
const SKILLS_DIR = join(PACKAGE_ROOT, 'skills');

const DIRS = [
  'sources',
  'authors',
  'knowledge/artifacts',
  'knowledge/sources',
  'knowledge/claims',
  'knowledge/evidence',
  'knowledge/facts',
  'knowledge/results',
  'knowledge/candidates',
  'knowledge/datasets',
  'research/questions',
  'research/hypotheses',
  'research/methods',
  'research/searches',
  'decisions',
  'reviews',
  'data',
  'analysis',
  'analysis/out',
  'figures',
  'figures/out',
  'tables',
  'tables/out',
  'manuscript',
  'manuscript/reports',
  'templates',
  'outputs',
  '.phdude/skills',
  '.phdude/cache',
];

const TEMPLATES_PATH = join('.phdude', 'templates.yaml');

// Kept in step with migrations/0003-workspace-v4.mjs: a workspace created at version 4 and one
// migrated to it hold the same registry.
const EMPTY_TEMPLATE_REGISTRY = { schema: 'phdude.templates', version: 1, templates: [] };

const POLICY_FILES = [
  'constitution.yaml',
  'research-policy.yaml',
  'writing-policy.yaml',
  'citation-policy.yaml',
  'methodology-policy.yaml',
  'publication-policy.yaml',
  'author-profile.yaml',
];

// Paths AgentHost implementations (claude-code, codex) may write. Snapshotting only these -
// never the whole workspace, and never `.git` or `.phdude/cache` - lets initWorkspace tell
// whether a path a host reports as `written` is a brand-new file (created) or one it rewrote
// (updated), without walking the tree.
const AGENT_HOST_COMMANDS_DIR = join('.claude', 'commands');

async function snapshotAgentHostFiles(store) {
  const paths = new Set();
  for (const rel of ['AGENTS.md', 'CLAUDE.md']) {
    if (await store.exists(rel)) paths.add(rel);
  }
  let entries = [];
  try {
    entries = await readdir(join(store.root, AGENT_HOST_COMMANDS_DIR));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  for (const name of entries) paths.add(join(AGENT_HOST_COMMANDS_DIR, name));
  return paths;
}

// Classifies each copied file as created (new), updated (existed with different
// content, rewritten) or skipped (existed with identical content, left untouched).
async function copyDirInto(srcDir, destRel, store, created, updated, skipped) {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destRelPath = join(destRel, entry.name);
    if (entry.isDirectory()) {
      await copyDirInto(srcPath, destRelPath, store, created, updated, skipped);
      continue;
    }
    const text = await readFile(srcPath, 'utf8');
    const existing = await store.readText(destRelPath);
    if (existing === null) {
      await store.writeTextAtomic(destRelPath, text);
      created.push(destRelPath);
    } else if (existing !== text) {
      await store.writeTextAtomic(destRelPath, text);
      updated.push(destRelPath);
    } else {
      skipped.push(destRelPath);
    }
  }
}

// Copies each `<srcDir>/<name>/` skill directory recursively into `.phdude/skills/<name>/`;
// skills are PhDude-owned so existing files are overwritten when their content changed
// (see copyDirInto for the created/updated/skipped classification) and this silently
// does nothing when srcDir doesn't exist.
//
// Every skill under srcDir is loaded and validated before anything is copied - a corrupt skill
// in the source tree must not leave a half-populated `.phdude/skills/`. A skill whose declared
// permissions the workspace policy has not opened is *withheld* rather than refused:
// `init` on a default workspace must still succeed, and simply not install the skill that
// wanted more than the policy grants. `discoverSkills` is injected (see
// adapters/skills/loader.js) so this application module never imports an adapter directly.
export async function copySkills(
  store,
  srcDir,
  created,
  updated,
  skipped,
  { policy, discoverSkills } = {},
) {
  const skills = await discoverSkills([{ dir: srcDir, source: 'core' }]);
  const withheld = [];
  for (const skill of skills) {
    const violation = skillPolicyViolation(skill, policy);
    if (violation) withheld.push({ name: skill.name, ...violation });
  }
  const withheldNames = new Set(withheld.map((entry) => entry.name));
  const installed = skills
    .filter((skill) => !withheldNames.has(skill.name))
    .map((skill) => skill.name);

  // A skill installed under an earlier permission is taken back off disk when the policy that
  // allowed it is closed again. De-indexing it from AGENTS.md alone would leave the file there
  // for anything that reads `.phdude/skills/` directly, so the withdrawal would be partial.
  const removed = [];
  for (const name of withheldNames) {
    const rel = join('.phdude', 'skills', name);
    if (!(await store.exists(rel))) continue;
    await rm(join(store.root, rel), { recursive: true, force: true });
    removed.push(rel);
  }

  let entries;
  try {
    entries = await readdir(srcDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return { withheld, installed, removed };
    throw err;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (withheldNames.has(entry.name)) continue;
    await copyDirInto(
      join(srcDir, entry.name),
      join('.phdude', 'skills', entry.name),
      store,
      created,
      updated,
      skipped,
    );
  }
  return { withheld, installed, removed };
}

/**
 * @returns {Promise<{ created: string[], updated: string[], skipped: string[],
 *   removed: string[], withheldSkills: {name: string, reason: string, hint: string}[],
 *   gitInitialized: boolean }>}
 */
export async function initWorkspace(
  { store, git, agentHosts = [], clock, actor, discoverSkills },
  { title, agents = [], noGit = false } = {},
) {
  const created = [];
  const updated = [];
  const skipped = [];

  for (const dir of DIRS) {
    if (dir === '.phdude/cache') continue;
    const rel = join(dir, '.gitkeep');
    if (await store.exists(rel)) {
      skipped.push(rel);
    } else {
      await store.writeTextAtomic(rel, '');
      created.push(rel);
    }
  }

  if (await store.exists('phdude.yaml')) {
    skipped.push('phdude.yaml');
  } else {
    const cfg = {
      schema: 'phdude.project',
      version: 1,
      workspace_version: CURRENT_WORKSPACE_VERSION,
      title,
      language: 'en',
      fields: [],
      methods: [],
      venues: [],
      outputs: ['thesis'],
      mode: 'full',
      agents,
    };
    await store.writeProject(cfg);
    created.push('phdude.yaml');
  }
  const project = await store.readProject();

  for (const file of POLICY_FILES) {
    const rel = join('.phdude', file);
    if (await store.exists(rel)) {
      skipped.push(rel);
      continue;
    }
    const text = await readFile(join(DEFAULTS_DIR, file), 'utf8');
    await store.writeTextAtomic(rel, text);
    created.push(rel);
  }

  if (await store.exists(TEMPLATES_PATH)) {
    skipped.push(TEMPLATES_PATH);
  } else {
    await store.writeYamlAtomic(TEMPLATES_PATH, EMPTY_TEMPLATE_REGISTRY);
    created.push(TEMPLATES_PATH);
  }

  const defaultGitignore = await readFile(join(DEFAULTS_DIR, 'workspace.gitignore'), 'utf8');
  const existingGitignore = await store.readText('.gitignore');
  if (existingGitignore === null) {
    await store.writeTextAtomic('.gitignore', defaultGitignore);
    created.push('.gitignore');
  } else {
    const existingLines = existingGitignore.split('\n');
    const defaultLines = defaultGitignore.split('\n').filter(Boolean);
    const missing = defaultLines.filter((l) => !existingLines.includes(l));
    if (missing.length > 0) {
      const sep = existingGitignore === '' || existingGitignore.endsWith('\n') ? '' : '\n';
      await store.writeTextAtomic(
        '.gitignore',
        existingGitignore + sep + missing.join('\n') + '\n',
      );
      created.push('.gitignore');
    } else {
      skipped.push('.gitignore');
    }
  }

  const policy = await store.readYaml(join('.phdude', 'research-policy.yaml'));
  const { withheld, installed, removed } = await copySkills(
    store,
    SKILLS_DIR,
    created,
    updated,
    skipped,
    { policy, discoverSkills },
  );

  if (agentHosts.length > 0) {
    const preExisting = await snapshotAgentHostFiles(store);
    // One status per path across every host: a `written` report from any host wins over a
    // `skipped` report for the same path from another host (e.g. codex deliberately leaving the
    // AGENTS.md claude-code just wrote in place), so a path is never reported twice.
    const status = new Map();
    for (const host of agentHosts) {
      // The hosts are told which skills were installed, so a withheld one is neither indexed
      // in AGENTS.md nor inlined into it: withholding a skill has to withhold its content too.
      const { written, skipped: hostSkipped } = await host.install(store.root, {
        project,
        skills: installed,
      });
      for (const rel of written) status.set(rel, 'written');
      for (const rel of hostSkipped) if (!status.has(rel)) status.set(rel, 'skipped');
    }
    for (const [rel, st] of status) {
      if (st === 'written') (preExisting.has(rel) ? updated : created).push(rel);
      else skipped.push(rel);
    }
  }

  let gitInitialized = false;
  if (!noGit && !(await git.isInsideRepo(store.root))) {
    await git.initRepo(store.root);
    gitInitialized = true;
  }

  await store.appendEvent({
    ts: clock(),
    op: 'init',
    actor,
    ids: [],
    summary: 'workspace initialized',
  });

  return { created, updated, skipped, removed, withheldSkills: withheld, gitInitialized };
}

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRENT_WORKSPACE_VERSION } from '../domain/versioning.js';
import { assertSkillPolicyOk } from './skills.js';

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
  'research/questions',
  'research/hypotheses',
  'decisions',
  'data',
  'analysis',
  'figures',
  'tables',
  'manuscript',
  'templates',
  'outputs',
  '.phdude/skills',
  '.phdude/cache',
];

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
// Every skill under srcDir is validated (contract, and network permission against `policy`)
// before anything is copied - a corrupt or over-privileged skill in the source tree must not
// leave a half-populated `.phdude/skills/`. `discoverSkills` is injected (see
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
  for (const skill of skills) assertSkillPolicyOk(skill, policy);

  let entries;
  try {
    entries = await readdir(srcDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await copyDirInto(
      join(srcDir, entry.name),
      join('.phdude', 'skills', entry.name),
      store,
      created,
      updated,
      skipped,
    );
  }
}

/**
 * @returns {Promise<{ created: string[], updated: string[], skipped: string[], gitInitialized: boolean }>}
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
  await copySkills(store, SKILLS_DIR, created, updated, skipped, { policy, discoverSkills });

  if (agentHosts.length > 0) {
    const preExisting = await snapshotAgentHostFiles(store);
    // One status per path across every host: a `written` report from any host wins over a
    // `skipped` report for the same path from another host (e.g. codex deliberately leaving the
    // AGENTS.md claude-code just wrote in place), so a path is never reported twice.
    const status = new Map();
    for (const host of agentHosts) {
      const { written, skipped: hostSkipped } = await host.install(store.root, { project });
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

  return { created, updated, skipped, gitInitialized };
}

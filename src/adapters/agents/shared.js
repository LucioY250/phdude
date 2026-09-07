import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { writeFileAtomic } from '../store/atomic.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DEFAULT_SKILLS_DIR = join(PACKAGE_ROOT, 'skills');
export const DEFAULT_COMMANDS_DIR = join(PACKAGE_ROOT, 'commands');

export const MANAGED_MARKER = '<!-- phdude:managed -->';
export const SKILLS_INDEX_MARKER = '<!-- phdude:skills-index -->';

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// Splits `SKILL.md` / command-template content into its YAML front matter (parsed) and body.
// Files without a front matter block, or whose front matter fails to parse (e.g. a hand-edited
// pre-existing file), are returned with `meta: null` and the untouched original text as body —
// callers must treat that the same as "no phdude metadata", never throw.
export function parseFrontMatter(text) {
  const m = FRONT_MATTER_RE.exec(text);
  if (!m) return { meta: {}, body: text };
  try {
    return { meta: parse(m[1]) ?? {}, body: text.slice(m[0].length) };
  } catch {
    return { meta: null, body: text };
  }
}

function parseSkill(text) {
  const { meta, body } = parseFrontMatter(text);
  return { meta: meta ?? {}, body: body.trim() };
}

// A file is PhDude-managed (safe to overwrite when its content has changed) when either its
// first line is the plain-text marker (AGENTS.md, CLAUDE.md), or its front matter declares
// `phdude-managed: true` (slash-command templates, whose front matter must start at line 1 for
// Claude Code to parse `description`/`allowed-tools`).
export function isPhdudeManaged(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (text.split('\n', 1)[0].trim() === MANAGED_MARKER) return true;
  return parseFrontMatter(text).meta?.['phdude-managed'] === true;
}

export async function readFileOrNull(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// Writes `content` to `<root>/<rel>` unless a pre-existing, non-PhDude-managed file is there, or
// the existing managed file already has identical content. Reports which happened so callers can
// classify the result into `written` / `skipped`.
export async function writeManagedFile(root, rel, content) {
  const abs = join(root, rel);
  const existing = await readFileOrNull(abs);
  if (existing === null) {
    await writeFileAtomic(abs, content);
    return { rel, status: 'written' };
  }
  if (!isPhdudeManaged(existing) || existing === content) {
    return { rel, status: 'skipped' };
  }
  await writeFileAtomic(abs, content);
  return { rel, status: 'written' };
}

async function listSkillNames(skillsDir) {
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function readSkill(skillsDir, name) {
  const text = await readFile(join(skillsDir, name, 'SKILL.md'), 'utf8');
  return parseSkill(text);
}

const COMMAND_ROWS = [
  ['init', 'Initialize a research workspace.'],
  ['bootstrap', 'Ingest, classify artifacts, extract knowledge, then report status and next.'],
  ['ingest', 'Discover, hash, and extract text from files under sources/.'],
  ['status', 'Show project, inventory, knowledge counts, conflicts, and pending decisions.'],
  ['next', 'Recommend the highest-impact next action.'],
  ['knowledge list|show|trace', 'Query and trace the knowledge graph.'],
  [
    'add <type>',
    'Add a candidate claim, evidence, fact, source, question, hypothesis, result, or artifact-role.',
  ],
  ['decide propose|approve|reject', 'Propose a Decision; the researcher approves or rejects it.'],
  ['promote', 'Promote an object to canonical; requires an approved Decision.'],
  ['packs list|detect|apply', 'List, recommend, or apply field/method research packs.'],
  ['mode', 'Set the review mode: lite, full, ruthless, or off.'],
  ['doctor', 'Report adapter availability, cache state, and schema versions.'],
];

function renderCommandTable() {
  const header = '| Command | Purpose |\n| --- | --- |';
  const rows = COMMAND_ROWS.map(([cmd, purpose]) => `| \`phdude ${cmd}\` | ${purpose} |`);
  return [header, ...rows].join('\n') + '\n\nEvery command supports `--json`.';
}

// Renders the shared AGENTS.md content: header, project title, phdude-core's operating rules
// inlined, the v0.1 command reference, then every other skill, sorted for deterministic output.
// `inlineSkills: true` (codex, which has no on-demand skill loading) inlines each skill's full
// body under `## Skill: <name>`. `inlineSkills: false` (Claude Code, which loads
// `.phdude/skills/<name>/SKILL.md` progressively) instead emits a one-line index per skill, so
// the file Claude Code auto-loads every session stays small (PRD S41b, S70).
export async function renderAgentsMd({
  project,
  skillsDir = DEFAULT_SKILLS_DIR,
  inlineSkills = true,
}) {
  const names = await listSkillNames(skillsDir);
  const core = names.includes('phdude-core')
    ? await readSkill(skillsDir, 'phdude-core')
    : { meta: {}, body: '' };
  const others = names.filter((n) => n !== 'phdude-core');

  const lines = [
    MANAGED_MARKER,
    ...(inlineSkills ? [] : [SKILLS_INDEX_MARKER]),
    '# PhDude research workspace',
    '',
    `Project: ${project?.title ?? '(untitled)'}`,
    '',
    '## Operating rules',
    '',
    core.body,
    '',
    '## Commands',
    '',
    renderCommandTable(),
  ];

  if (inlineSkills) {
    for (const name of others) {
      const skill = await readSkill(skillsDir, name);
      lines.push('', `## Skill: ${name}`, '', skill.body);
    }
  } else {
    lines.push('', '## Skills', '', 'Load a skill only when its command or task is active:', '');
    for (const name of others) {
      const skill = await readSkill(skillsDir, name);
      const description = skill.meta.description ?? '';
      lines.push(`- **${name}** - ${description} -> .phdude/skills/${name}/SKILL.md`);
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

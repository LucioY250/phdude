import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { writeFileAtomic } from '../store/atomic.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DEFAULT_SKILLS_DIR = join(PACKAGE_ROOT, 'skills');
export const DEFAULT_COMMANDS_DIR = join(PACKAGE_ROOT, 'commands');

export const MANAGED_MARKER = '<!-- phdude:managed -->';

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// Splits `SKILL.md` / command-template content into its YAML front matter (parsed) and body.
// Files without a front matter block are returned with an empty meta object.
export function parseFrontMatter(text) {
  const m = FRONT_MATTER_RE.exec(text);
  if (!m) return { meta: {}, body: text };
  return { meta: parse(m[1]) ?? {}, body: text.slice(m[0].length) };
}

function parseSkill(text) {
  const { meta, body } = parseFrontMatter(text);
  return { meta, body: body.trim() };
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

async function readTextOrNull(path) {
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
  const existing = await readTextOrNull(abs);
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

async function readSkillBody(skillsDir, name) {
  const text = await readFile(join(skillsDir, name, 'SKILL.md'), 'utf8');
  return parseSkill(text).body;
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
// inlined, the v0.1 command reference, then every other skill under `## Skill: <name>`, sorted
// for deterministic output.
export async function renderAgentsMd({ project, skillsDir = DEFAULT_SKILLS_DIR }) {
  const names = await listSkillNames(skillsDir);
  const coreBody = names.includes('phdude-core')
    ? await readSkillBody(skillsDir, 'phdude-core')
    : '';
  const others = names.filter((n) => n !== 'phdude-core');

  const lines = [
    MANAGED_MARKER,
    '# PhDude research workspace',
    '',
    `Project: ${project?.title ?? '(untitled)'}`,
    '',
    '## Operating rules',
    '',
    coreBody,
    '',
    '## Commands',
    '',
    renderCommandTable(),
  ];

  for (const name of others) {
    lines.push('', `## Skill: ${name}`, '', await readSkillBody(skillsDir, name));
  }

  return lines.join('\n').trimEnd() + '\n';
}

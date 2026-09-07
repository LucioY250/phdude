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

// `only` is the list of skills actually installed in this workspace. A skill the research
// policy withheld (a network skill without `skills.allow_network`) must not be indexed here or
// inlined below either: withholding a skill has to withhold its content, not just its file.
async function listSkillNames(skillsDir, only) {
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const names = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  return Array.isArray(only) ? names.filter((name) => only.includes(name)) : names;
}

async function readSkill(skillsDir, name) {
  const text = await readFile(join(skillsDir, name, 'SKILL.md'), 'utf8');
  return parseSkill(text);
}

// The agent-facing command reference (AGENTS.md). One row per command in
// `adapters/cli/args.js`'s COMMAND_OPTIONS; `tests/unit/cli/surface.test.js` fails when the two
// drift apart, because an agent that cannot see a command will not run it.
export const COMMAND_ROWS = [
  ['init', 'Create a research workspace, or refresh an existing one.'],
  ['bootstrap', 'Ingest, classify artifacts, extract knowledge, then report status and next.'],
  ['ingest', 'Discover, hash, and extract text from files under sources/.'],
  [
    'status',
    'Show project, inventory, knowledge counts, conflicts, disputed pairs, and pending decisions.',
  ],
  ['next', 'Recommend the highest-impact next action.'],
  ['knowledge list|show|trace', 'Query and trace the knowledge graph, provenance included.'],
  [
    'add <type>',
    'Add a candidate claim, evidence, fact, source, question, hypothesis, method, result, or artifact-role.',
  ],
  [
    'link <id> --to <id>...',
    'Attach evidence, questions or artifacts to an object; --contradicts records a contradiction instead.',
  ],
  [
    'decide propose|approve|reject|supersede',
    'Propose a Decision; the researcher approves, rejects, or supersedes it.',
  ],
  ['promote', 'Promote an object to canonical; requires an approved Decision.'],
  [
    'cite list|check|export',
    'Citation registry: list sources, verify them, export BibTeX/CSL-JSON.',
  ],
  [
    'research "<query>"|list|show|accept|dismiss',
    'Search the literature through the configured providers and record the candidates; the researcher accepts them, never you.',
  ],
  [
    'research-fresh',
    'Re-run the recorded searches that have gone stale, and report only what is new.',
  ],
  [
    'freshness',
    'Report the last search per research question, the age of every source, and what is stale.',
  ],
  [
    "edit <id> --json '<fields>'",
    'Correct the non-identity fields of a non-canonical object; identity fields are never editable.',
  ],
  ['matrix', 'Literature matrix: one row per source, with the questions and claims it reaches.'],
  [
    'gaps',
    'Research gaps: questions, claims, sources, artifacts, and conflicts needing attention.',
  ],
  [
    'prose <section> | --file <path>',
    'Academic Prose Quality report over a manuscript section or a text file: six located sub-scores and the observations behind them. Never an AI-detector score.',
  ],
  [
    'write <section>',
    'Assemble the bounded writing context for a section and print the draft contract. It writes cache, never prose.',
  ],
  [
    'deslop <section>',
    'The revision contract for a section, or a revision run through every gate; the meaning gate refuses a revision that loses a claim, a citation, a number or a negation.',
  ],
  [
    'manuscript init|list|show|status|submit|approve|reopen',
    'The manuscript: its sections, their status, submitting a draft through the writing gates, and the approval the researcher decides.',
  ],
  [
    'authors list|show|add|learn|consensus',
    'Per-researcher voice profiles: tone, sentence style, and terminology, learned from ' +
      'approved samples; consensus merges them for collaborative projects.',
  ],
  ['packs list|detect|apply', 'List, recommend, or apply field/method research packs.'],
  ['mode', 'Set the review mode: lite, full, ruthless, or off.'],
  ['migrate', 'Upgrade the workspace to the current version. The researcher runs this, never you.'],
  ['doctor', 'Report adapter availability, cache state, schema versions, and skill permissions.'],
  ['help', 'Print the command list, the global options, and the exit codes.'],
];

function renderCommandTable() {
  const header = '| Command | Purpose |\n| --- | --- |';
  const rows = COMMAND_ROWS.map(([cmd, purpose]) => `| \`phdude ${cmd}\` | ${purpose} |`);
  return [header, ...rows].join('\n') + '\n\nEvery command supports `--json`.';
}

// Renders the shared AGENTS.md content: header, project title, phdude-core's operating rules
// inlined, the command reference, then every other skill, sorted for deterministic output.
// `inlineSkills: true` (codex, which has no on-demand skill loading) inlines each skill's full
// body under `## Skill: <name>`. `inlineSkills: false` (Claude Code, which loads
// `.phdude/skills/<name>/SKILL.md` progressively) instead emits a one-line index per skill, so
// the file Claude Code auto-loads every session stays small (PRD S41b, S70). `skills`, when
// given, is the list of skill names actually installed; anything else under `skillsDir` is left
// out of both forms.
export async function renderAgentsMd({
  project,
  skillsDir = DEFAULT_SKILLS_DIR,
  inlineSkills = true,
  skills,
}) {
  const names = await listSkillNames(skillsDir, skills);
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

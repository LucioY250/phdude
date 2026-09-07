import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_COMMANDS_DIR,
  DEFAULT_SKILLS_DIR,
  MANAGED_MARKER,
  renderAgentsMd,
  writeManagedFile,
} from './shared.js';

// `commands/phdude.md` is the dispatcher and installs as `/phdude`; every other template
// installs as `/phdude-<command>`.
function slashNameFor(file) {
  const base = file.replace(/\.md$/, '');
  return base === 'phdude' ? '/phdude' : `/phdude-${base}`;
}

// Wraps the slash-command names at 88 columns so CLAUDE.md stays readable as the list grows.
function wrapNames(names, width) {
  const lines = [];
  let current = '';
  for (const name of names) {
    const item = `\`${name}\`,`;
    if (current === '') current = item;
    else if (current.length + 1 + item.length <= width) current += ` ${item}`;
    else {
      lines.push(current);
      current = item;
    }
  }
  if (current !== '') lines.push(current);
  const last = lines.length - 1;
  lines[last] = lines[last].replace(/,$/, '').replace(/`,$/, '`');
  return lines;
}

// Derived from the templates actually installed, never hand-listed: a command whose template
// exists is a slash command the researcher can type, and CLAUDE.md must not claim otherwise.
function renderClaudeMd(commandFiles) {
  // The dispatcher leads; plain filename order would bury it between `packs` and `promote`.
  const names = commandFiles.map(slashNameFor).sort((a, b) => {
    if (a === '/phdude') return -1;
    if (b === '/phdude') return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return [
    MANAGED_MARKER,
    '@AGENTS.md',
    '',
    '## Claude Code notes',
    '',
    'PhDude slash commands live under `.claude/commands/`:',
    '',
    ...wrapNames(names, 88),
    '',
    'Each wraps the CLI: run it with `--json` and follow the matching skill under',
    '`.phdude/skills/<name>/SKILL.md`.',
    'AGENTS.md below lists skills by name and description only; load a skill file itself only',
    'when its command or task is actually active, not up front.',
    '',
  ].join('\n');
}

async function listCommandFiles(commandsDir) {
  try {
    return (await readdir(commandsDir)).filter((f) => f.endsWith('.md')).sort();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export const claudeCodeHost = {
  name: 'claude-code',
  async install(
    root,
    { project, skillsDir = DEFAULT_SKILLS_DIR, commandsDir = DEFAULT_COMMANDS_DIR } = {},
  ) {
    const written = [];
    const skipped = [];
    const record = ({ rel, status }) => (status === 'written' ? written : skipped).push(rel);

    const commandFiles = await listCommandFiles(commandsDir);

    const agentsMd = await renderAgentsMd({ project, skillsDir, inlineSkills: false });
    record(await writeManagedFile(root, 'AGENTS.md', agentsMd));
    record(await writeManagedFile(root, 'CLAUDE.md', renderClaudeMd(commandFiles)));

    for (const file of commandFiles) {
      const text = await readFile(join(commandsDir, file), 'utf8');
      const destRel =
        file === 'phdude.md'
          ? join('.claude', 'commands', 'phdude.md')
          : join('.claude', 'commands', `phdude-${file}`);
      record(await writeManagedFile(root, destRel, text));
    }

    return { written, skipped };
  },
};

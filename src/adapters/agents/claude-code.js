import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_COMMANDS_DIR,
  DEFAULT_SKILLS_DIR,
  MANAGED_MARKER,
  renderAgentsMd,
  writeManagedFile,
} from './shared.js';

function renderClaudeMd() {
  return [
    MANAGED_MARKER,
    '@AGENTS.md',
    '',
    '## Claude Code notes',
    '',
    'PhDude slash commands live under `.claude/commands/` (`/phdude`, `/phdude-bootstrap`,',
    '`/phdude-ingest`, `/phdude-status`, `/phdude-next`, `/phdude-knowledge`, `/phdude-packs`,',
    '`/phdude-add`, `/phdude-decide`, `/phdude-doctor`, `/phdude-mode`). Each wraps the CLI: run',
    'it with `--json` and follow the matching skill under `.phdude/skills/<name>/SKILL.md`.',
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

    const agentsMd = await renderAgentsMd({ project, skillsDir });
    record(await writeManagedFile(root, 'AGENTS.md', agentsMd));
    record(await writeManagedFile(root, 'CLAUDE.md', renderClaudeMd()));

    for (const file of await listCommandFiles(commandsDir)) {
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

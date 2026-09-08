import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import {
  DEFAULT_COMMANDS_DIR,
  DEFAULT_SKILLS_DIR,
  listCommandFiles,
  parseFrontMatter,
  renderAgentsMd,
  writeManagedFile,
} from './shared.js';

const COMMAND_DIR = join('.opencode', 'command');

// OpenCode reads AGENTS.md and opens a command file only when the researcher types it, so it
// takes the compact skills index Claude Code takes rather than codex's fully inlined variant —
// identical bytes, so whichever of the two runs second leaves the file alone.
//
// Its command front matter understands `description`; `allowed-tools` is a Claude Code key and
// does not survive the copy. `phdude-managed` does, because that marker is what stops the next
// `init` from overwriting a file the researcher has taken over.
function renderCommand(text) {
  const { meta, body } = parseFrontMatter(text);
  const front = stringify(
    { description: meta?.description ?? '', 'phdude-managed': true },
    { lineWidth: 0 },
  );
  return `---\n${front}---\n${body}`;
}

export const opencodeHost = {
  name: 'opencode',
  async install(
    root,
    {
      project,
      skills,
      externalSkills,
      skillsDir = DEFAULT_SKILLS_DIR,
      commandsDir = DEFAULT_COMMANDS_DIR,
    } = {},
  ) {
    const written = [];
    const skipped = [];
    const record = ({ rel, status }) => (status === 'written' ? written : skipped).push(rel);

    const agentsMd = await renderAgentsMd({
      project,
      skillsDir,
      inlineSkills: false,
      skills,
      externalSkills,
      externalSkillsDir: join(root, '.phdude', 'skills'),
    });
    record(await writeManagedFile(root, 'AGENTS.md', agentsMd));

    for (const file of await listCommandFiles(commandsDir)) {
      const text = await readFile(join(commandsDir, file), 'utf8');
      const destRel = join(COMMAND_DIR, file === 'phdude.md' ? 'phdude.md' : `phdude-${file}`);
      record(await writeManagedFile(root, destRel, renderCommand(text)));
    }

    return { written, skipped };
  },
};

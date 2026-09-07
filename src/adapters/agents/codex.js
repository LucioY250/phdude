import { DEFAULT_SKILLS_DIR, renderAgentsMd, writeManagedFile } from './shared.js';

// Codex reads AGENTS.md only; it has no slash-command mechanism.
export const codexHost = {
  name: 'codex',
  async install(root, { project, skillsDir = DEFAULT_SKILLS_DIR } = {}) {
    const content = await renderAgentsMd({ project, skillsDir });
    const result = await writeManagedFile(root, 'AGENTS.md', content);
    return result.status === 'written'
      ? { written: [result.rel], skipped: [] }
      : { written: [], skipped: [result.rel] };
  },
};

import { join } from 'node:path';
import {
  DEFAULT_SKILLS_DIR,
  SKILLS_INDEX_MARKER,
  isPhdudeManaged,
  readFileOrNull,
  renderAgentsMd,
  writeManagedFile,
} from './shared.js';

// Codex reads AGENTS.md only; it has no slash-command mechanism. It always inlines every skill's
// full body (it has no on-demand skill loading), unless Claude Code already wrote the smaller
// index variant in this same install run (or an earlier one) — that variant wins, so codex never
// clobbers it back into the large inlined form.
export const codexHost = {
  name: 'codex',
  async install(root, { project, skillsDir = DEFAULT_SKILLS_DIR } = {}) {
    const existing = await readFileOrNull(join(root, 'AGENTS.md'));
    if (existing !== null && isPhdudeManaged(existing) && existing.includes(SKILLS_INDEX_MARKER)) {
      return { written: [], skipped: ['AGENTS.md'] };
    }
    const content = await renderAgentsMd({ project, skillsDir, inlineSkills: true });
    const result = await writeManagedFile(root, 'AGENTS.md', content);
    return result.status === 'written'
      ? { written: [result.rel], skipped: [] }
      : { written: [], skipped: [result.rel] };
  },
};

import { basename } from 'node:path';
import { initWorkspace } from '../../../application/init.js';
import { PhdudeError } from '../../../domain/errors.js';
import { claudeCodeHost } from '../../agents/claude-code.js';
import { codexHost } from '../../agents/codex.js';

const HOSTS = { 'claude-code': claudeCodeHost, codex: codexHost };
const DEFAULT_AGENTS = ['claude-code', 'codex'];

export default async function init({ flags, deps, workspace }) {
  const agents = flags.agents ?? DEFAULT_AGENTS;
  const agentHosts = agents.map((name) => {
    const host = HOSTS[name];
    if (!host) {
      throw new PhdudeError(
        'USAGE',
        `unknown agent host: ${name}`,
        `known hosts: ${Object.keys(HOSTS).join(', ')}`,
      );
    }
    return host;
  });

  const title = flags.title ?? basename(workspace);
  const result = await initWorkspace(
    {
      store: deps.store,
      git: deps.git,
      agentHosts,
      clock: deps.clock,
      actor: deps.actor,
      discoverSkills: deps.discoverSkills,
    },
    { title, agents, noGit: flags.noGit },
  );

  const git = flags.noGit
    ? 'skipped (--no-git)'
    : result.gitInitialized
      ? 'initialized'
      : 'already inside a repository';

  const text =
    [
      `Initialized PhDude workspace at ${workspace}`,
      `  title:   ${title}`,
      `  agents:  ${agents.length ? agents.join(', ') : '(none)'}`,
      `  created: ${result.created.length}`,
      `  updated: ${result.updated.length}`,
      `  skipped: ${result.skipped.length}`,
      `  git:     ${git}`,
      '',
      'Next: drop research materials into sources/ and run `phdude bootstrap`.',
    ].join('\n') + '\n';

  return { text, json: { workspace, title, agents, git, ...result } };
}

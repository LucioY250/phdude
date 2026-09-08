import { basename } from 'node:path';
import { initWorkspace } from '../../../application/init.js';
import { DEFAULT_AGENTS, hostsFor } from '../../agents/hosts.js';

export default async function init({ flags, deps, workspace }) {
  const agents = flags.agents ?? DEFAULT_AGENTS;
  const agentHosts = hostsFor(agents);

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

  // A skill the policy withheld is reported by name with the setting that would install it:
  // silently shipping one fewer skill than the package carries is how an agent ends up
  // looking for a file that is not there.
  const withheld = result.withheldSkills.flatMap((entry) => [
    `  skill ${entry.name} was not installed: ${entry.reason}`,
    `    ${entry.hint}`,
  ]);

  // Only when it happened: a `removed: 0` on every ordinary init would be noise, and taking a
  // skill back off disk is rare enough to deserve the line when it does.
  const removed = result.removed.length > 0 ? [`  removed: ${result.removed.length}`] : [];

  const text =
    [
      `Initialized PhDude workspace at ${workspace}`,
      `  title:   ${title}`,
      `  agents:  ${agents.length ? agents.join(', ') : '(none)'}`,
      `  created: ${result.created.length}`,
      `  updated: ${result.updated.length}`,
      `  skipped: ${result.skipped.length}`,
      ...removed,
      `  git:     ${git}`,
      ...withheld,
      '',
      'Next: drop research materials into sources/ and run `phdude bootstrap`.',
    ].join('\n') + '\n';

  return { text, json: { workspace, title, agents, git, ...result } };
}

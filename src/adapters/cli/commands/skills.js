import { resolve } from 'node:path';
import * as skills from '../../../application/skills.js';
import { indexAgentSkills } from '../../../application/init.js';
import { classifySkillSource } from '../../../domain/skills.js';
import { PhdudeError } from '../../../domain/errors.js';
import { knownHosts } from '../../agents/hosts.js';

function renderList({ skills: entries, warnings }) {
  const lines = [];
  if (entries.length === 0) {
    lines.push('(no skills found)');
  } else {
    const width = Math.max(...entries.map((s) => s.name.length));
    for (const skill of entries) {
      const origin = skill.external ? `${skill.origin}${skill.drifted ? ' (edited)' : ''}` : '';
      lines.push(
        `${skill.name.padEnd(width)}  ${(skill.external ? 'external' : skill.source).padEnd(9)} ${origin}`.trimEnd(),
      );
    }
  }
  if (warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of warnings) lines.push(`  - ${warning}`);
  }
  return lines.join('\n') + '\n';
}

// Installing or removing a skill changes what the workspace loads, so the files the agent reads
// - AGENTS.md, CLAUDE.md - are rewritten to match. The hosts come from what `init` recorded in
// `phdude.yaml`; a workspace that named no agent host gets nothing rewritten.
async function reindex(deps) {
  const project = await deps.store.readProject();
  return indexAgentSkills({
    store: deps.store,
    agentHosts: knownHosts(project?.agents),
    discoverSkills: deps.discoverSkills,
    skillsDir: deps.skillsDir,
  });
}

// The source is resolved here rather than in the application because only the adapter knows the
// shell's working directory; a git URL is passed through untouched.
function sourceArg(raw, cwd) {
  const classified = classifySkillSource(raw);
  return classified.kind === 'path' ? resolve(cwd, classified.path) : classified.url;
}

export default async function skillsCommand({ sub, positionals, flags, deps, cwd }) {
  if (sub === 'list' || sub === undefined || sub === null) {
    const result = await skills.list({
      store: deps.store,
      loadPacks: deps.loadPacks,
      discoverSkills: deps.discoverSkills,
      skillsDir: deps.skillsDir,
      readSkillSource: deps.readSkillSource,
    });
    return { text: renderList(result), json: result };
  }

  if (sub === 'install') {
    const raw = positionals[2];
    if (!raw) {
      throw new PhdudeError(
        'USAGE',
        'skills install needs a directory or an https git URL',
        'phdude skills install <path|https://…>',
      );
    }
    const result = await skills.install(
      {
        store: deps.store,
        discoverSkills: deps.discoverSkills,
        skillsDir: deps.skillsDir,
        loadSkill: deps.loadSkill,
        readSkillSource: deps.readSkillSource,
        writeSkillTree: deps.writeSkillTree,
        cloneSkill: deps.cloneSkill,
        tempDir: deps.tempSkillDir,
        removeDir: deps.removeSkillDir,
        clock: deps.clock,
        actor: deps.actor,
      },
      sourceArg(raw, cwd),
      { allowNetwork: flags.allowNetwork, force: flags.force },
    );
    const indexed = await reindex(deps);
    const verb = result.replaced ? 'Replaced' : 'Installed';
    const files = `${result.files} file${result.files === 1 ? '' : 's'}`;
    const lines = [`${verb} skill ${result.name} from ${result.source} (${files})`];
    if (indexed.written.length > 0) lines.push(`Indexed in ${indexed.written.join(', ')}`);
    return { text: lines.join('\n') + '\n', json: { ...result, indexed: indexed.written } };
  }

  if (sub === 'remove') {
    const name = positionals[2];
    if (!name) {
      throw new PhdudeError('USAGE', 'skills remove needs a skill name', 'phdude skills list');
    }
    const result = await skills.remove(
      {
        store: deps.store,
        discoverSkills: deps.discoverSkills,
        skillsDir: deps.skillsDir,
        removeDir: deps.removeSkillDir,
        clock: deps.clock,
        actor: deps.actor,
      },
      name,
    );
    const indexed = await reindex(deps);
    const lines = [`Removed skill ${result.name}`];
    if (indexed.written.length > 0) lines.push(`Indexed in ${indexed.written.join(', ')}`);
    return { text: lines.join('\n') + '\n', json: { ...result, indexed: indexed.written } };
  }

  throw new PhdudeError(
    'USAGE',
    `unknown skills sub-command: ${sub}`,
    'valid sub-commands: list, install, remove',
  );
}

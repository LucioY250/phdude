import { resolve } from 'node:path';
import * as skills from '../../../application/skills.js';
import { classifySkillSource } from '../../../domain/skills.js';
import { PhdudeError } from '../../../domain/errors.js';

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
    const verb = result.replaced ? 'Replaced' : 'Installed';
    const files = `${result.files} file${result.files === 1 ? '' : 's'}`;
    return {
      text: `${verb} skill ${result.name} from ${result.source} (${files})\n`,
      json: result,
    };
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
    return { text: `Removed skill ${result.name}\n`, json: result };
  }

  throw new PhdudeError(
    'USAGE',
    `unknown skills sub-command: ${sub}`,
    'valid sub-commands: list, install, remove',
  );
}

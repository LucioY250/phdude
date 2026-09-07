import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import * as authors from '../../../application/authors.js';
import { PhdudeError } from '../../../domain/errors.js';
import { parseJsonArg } from '../args.js';

function renderList(profiles) {
  if (profiles.length === 0) return '(no author profiles)\n';
  const lines = profiles.map((p) => {
    const learned = p.learned ? 'learned' : 'not learned';
    return `${p.id.padEnd(24)} ${(p.language ?? '-').padEnd(4)} ${learned.padEnd(11)} ${(p.samples ?? []).length} sample(s)`;
  });
  lines.push('', `${profiles.length} author profile(s)`);
  return lines.join('\n') + '\n';
}

function renderLearn(profile, count) {
  return (
    [
      `Learned voice for ${profile.id} from ${count} sample(s):`,
      '',
      stringify(profile.learned, { lineWidth: 0 }).trimEnd(),
    ].join('\n') + '\n'
  );
}

function renderConsensus(result) {
  if (!result.changed) return 'project-consensus unchanged; no decision proposed\n';
  return `project-consensus updated; ${result.decision.id} proposed\n`;
}

function readTextRelativeTo(cwd) {
  return (path) => readFile(resolve(cwd, path), 'utf8');
}

export default async function authorsCommand({ sub, positionals, flags, deps, cwd }) {
  const storeDeps = { store: deps.store };

  if (sub === 'list' || sub === undefined || sub === null) {
    const profiles = await authors.list(storeDeps);
    return { text: renderList(profiles), json: profiles };
  }

  if (sub === 'show') {
    const id = positionals[2];
    if (!id) {
      throw new PhdudeError('USAGE', 'authors show needs an id', 'phdude authors show <id>');
    }
    const profile = await authors.show(storeDeps, id);
    return { text: stringify(profile, { lineWidth: 0 }), json: profile };
  }

  if (sub === 'add') {
    if (!flags.jsonPayload) {
      throw new PhdudeError(
        'USAGE',
        'authors add needs an object',
        `pass --json '{"id":"researcher-a",…}'`,
      );
    }
    const input = parseJsonArg(flags.jsonPayload, '--json');
    const profile = await authors.add(
      { store: deps.store, clock: deps.clock, actor: deps.actor },
      input,
    );
    return { text: `Added author profile ${profile.id}\n`, json: profile };
  }

  if (sub === 'learn') {
    const id = positionals[2];
    if (!id) {
      throw new PhdudeError(
        'USAGE',
        'authors learn needs an id',
        'phdude authors learn <id> --from <path…> [--approved]',
      );
    }
    if (flags.from.length === 0) {
      throw new PhdudeError(
        'USAGE',
        'authors learn needs at least one --from <path>',
        `phdude authors learn ${id} --from <path…> [--approved]`,
      );
    }
    const profile = await authors.learn(
      {
        store: deps.store,
        clock: deps.clock,
        actor: deps.actor,
        cwd,
        readText: readTextRelativeTo(cwd),
      },
      id,
      { paths: flags.from, approved: flags.approved },
    );
    return { text: renderLearn(profile, flags.from.length), json: profile };
  }

  if (sub === 'consensus') {
    const result = await authors.consensus({
      store: deps.store,
      clock: deps.clock,
      actor: deps.actor,
    });
    return { text: renderConsensus(result), json: result };
  }

  throw new PhdudeError(
    'USAGE',
    `unknown authors sub-command: ${sub}`,
    'valid sub-commands: list, show, add, learn, consensus',
  );
}

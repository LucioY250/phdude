import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { addEntity } from '../../../application/add.js';
import { PhdudeError } from '../../../domain/errors.js';
import { parseJsonArg } from '../args.js';

async function readInput({ flags, cwd }) {
  if (flags.jsonPayload) return parseJsonArg(flags.jsonPayload, '--json');
  if (flags.file) {
    const path = resolve(cwd, flags.file);
    let text;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      throw new PhdudeError('USAGE', `cannot read ${flags.file}: ${err.message}`);
    }
    return parseJsonArg(text, `--file ${flags.file}`);
  }
  throw new PhdudeError(
    'USAGE',
    'add needs an object',
    `pass --json '{"…":"…"}' or --file <path>.json`,
  );
}

export default async function addCommand(ctx) {
  const { positionals, deps } = ctx;
  const type = positionals[1];
  if (!type) {
    throw new PhdudeError(
      'USAGE',
      'add needs an object type',
      'types: claim, evidence, fact, source, question, hypothesis, method, result, artifact-role',
    );
  }

  const input = await readInput(ctx);
  const { obj, created, updated } = await addEntity(
    { store: deps.store, clock: deps.clock, actor: deps.actor },
    type,
    input,
  );

  if (created) {
    const state = obj.state ? ` (${obj.state})` : '';
    return { text: `Added ${obj.id}${state}\n`, json: obj };
  }
  const text = updated ? `Updated ${obj.id} role → ${obj.role}\n` : `Unchanged ${obj.id}\n`;
  return { text, json: obj };
}

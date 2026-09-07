import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { edit } from '../../../application/edit.js';
import { PhdudeError } from '../../../domain/errors.js';
import { parseJsonArg } from '../args.js';

async function readFields({ flags, cwd }) {
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
    'edit needs the fields to change',
    `pass --json '{"…":"…"}' or --file <path>.json`,
  );
}

export default async function editCommand(ctx) {
  const { positionals, deps } = ctx;
  const id = positionals[1];
  if (!id) {
    throw new PhdudeError(
      'USAGE',
      'edit needs an object id',
      `phdude edit <id> --json '{"tags":["…"]}'`,
    );
  }

  const fields = await readFields(ctx);
  const obj = await edit({ store: deps.store, clock: deps.clock, actor: deps.actor }, id, fields);
  return { text: `Edited ${obj.id}: ${Object.keys(fields).sort().join(', ')}\n`, json: obj };
}

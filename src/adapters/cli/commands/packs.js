import * as packs from '../../../application/packs.js';
import { PhdudeError } from '../../../domain/errors.js';

function renderList(entries) {
  if (entries.length === 0) return '(no packs found)\n';
  return (
    entries
      .map(
        (p) =>
          `${p.applied ? '[x]' : '[ ]'} ${p.name.padEnd(20)} ${p.kind.padEnd(7)} ${p.description}`,
      )
      .join('\n') + '\n'
  );
}

function renderDetect(result) {
  const lines = ['Detection scores:'];
  if (result.scores.length === 0) lines.push('  (no keyword matches in the extracted text)');
  for (const s of result.scores) {
    const hits = s.hits.map((h) => h.keyword).join(', ');
    lines.push(`  ${s.name.padEnd(20)} ${s.kind.padEnd(7)} ${s.score.toFixed(3)}  ${hits}`);
  }
  lines.push('');
  lines.push(
    result.recommended.length
      ? `Recommended: ${result.recommended.join(', ')}`
      : 'Recommended: (none)',
  );
  lines.push('Nothing was applied; run `phdude packs apply <name>` to adopt one.');
  return lines.join('\n') + '\n';
}

export async function runDetect({ deps }) {
  return packs.detect({
    store: deps.store,
    loadPacks: deps.loadPacks,
    clock: deps.clock,
    actor: deps.actor,
  });
}

export default async function packsCommand(ctx) {
  const { sub, positionals, deps } = ctx;

  if (sub === 'list' || sub === undefined || sub === null) {
    const entries = await packs.list({ store: deps.store, loadPacks: deps.loadPacks });
    return { text: renderList(entries), json: entries };
  }

  if (sub === 'detect') {
    const result = await runDetect(ctx);
    return { text: renderDetect(result), json: result };
  }

  if (sub === 'apply') {
    const name = positionals[2];
    if (!name) {
      throw new PhdudeError('USAGE', 'packs apply needs a pack name', 'phdude packs list');
    }
    const result = await packs.apply(
      {
        store: deps.store,
        loadPacks: deps.loadPacks,
        clock: deps.clock,
        actor: deps.actor,
        loadSkill: deps.loadSkill,
      },
      name,
    );
    const text = result.applied ? `Applied ${name}\n` : `${name} was already applied\n`;
    return { text, json: { name, ...result } };
  }

  throw new PhdudeError(
    'USAGE',
    `unknown packs sub-command: ${sub}`,
    'valid sub-commands: list, detect, apply',
  );
}

import { stringify } from 'yaml';
import * as knowledge from '../../../application/knowledge.js';
import { PhdudeError } from '../../../domain/errors.js';

const SUMMARY_WIDTH = 72;

function summarize(obj) {
  const text =
    obj.statement ??
    obj.excerpt ??
    (obj.key !== undefined ? `${obj.key} = ${obj.value}` : undefined) ??
    obj.title ??
    obj.summary ??
    obj.text ??
    obj.name ??
    obj.path ??
    '';
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  return oneLine.length > SUMMARY_WIDTH ? `${oneLine.slice(0, SUMMARY_WIDTH - 1)}…` : oneLine;
}

function renderList(objs) {
  if (objs.length === 0) return '(no matching objects)\n';
  const lines = objs.map(
    (o) => `${o.id.padEnd(18)} ${(o.state ?? '-').padEnd(10)} ${summarize(o)}`,
  );
  lines.push('', `${objs.length} object(s)`);
  return lines.join('\n') + '\n';
}

// Claims and evidence carry where they came from; a lineage report that omitted it would
// leave the reader to guess whether a human or an extraction put the object there.
function renderProvenance(obj) {
  const provenance = obj?.provenance;
  if (!provenance) return null;
  const derived = provenance.derived_from.length ? ` ← ${provenance.derived_from.join(', ')}` : '';
  return `  provenance: ${provenance.method}${derived}`;
}

function renderTrace(result) {
  const lines = [result.id];
  const provenance = renderProvenance(result.obj);
  if (provenance) lines.push(provenance);
  for (const [label, objs] of [
    ['up (what it rests on)', result.up],
    ['down (what rests on it)', result.down],
  ]) {
    lines.push(`  ${label}:`);
    if (objs.length === 0) lines.push('    (none)');
    else for (const o of objs) lines.push(`    ${o.id.padEnd(18)} ${summarize(o)}`);
  }
  return lines.join('\n') + '\n';
}

export default async function knowledgeCommand({ sub, positionals, flags, deps }) {
  const storeDeps = { store: deps.store };

  if (sub === 'list' || sub === undefined || sub === null) {
    const objs = await knowledge.list(storeDeps, {
      type: flags.type,
      state: flags.state,
      query: flags.query,
    });
    return { text: renderList(objs), json: objs };
  }

  if (sub === 'show') {
    const id = positionals[2] ?? flags.id;
    if (!id)
      throw new PhdudeError('USAGE', 'knowledge show needs an id', 'phdude knowledge show <id>');
    const obj = await knowledge.show(storeDeps, id);
    return { text: stringify(obj, { lineWidth: 0 }), json: obj };
  }

  if (sub === 'trace') {
    const id = positionals[2] ?? flags.id;
    if (!id) {
      throw new PhdudeError('USAGE', 'knowledge trace needs an id', 'phdude knowledge trace <id>');
    }
    const result = await knowledge.trace(storeDeps, id);
    return { text: renderTrace(result), json: result };
  }

  throw new PhdudeError(
    'USAGE',
    `unknown knowledge sub-command: ${sub}`,
    'valid sub-commands: list, show, trace',
  );
}

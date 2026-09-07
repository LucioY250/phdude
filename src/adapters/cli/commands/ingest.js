import { ingest } from '../../../application/ingest.js';

export function renderIngest(result) {
  const written = new Set(result.artifacts.map((a) => a.id));
  const lines = [
    `Ingested ${result.artifacts.length} artifact(s), ${result.skipped.length} unchanged.`,
    '',
    `Inventory (${result.inventory.length} artifact(s), + = written this run):`,
  ];
  if (result.inventory.length === 0) lines.push('  (none)');
  for (const a of result.inventory) {
    const version = a.latest === false ? ` superseded by a newer version of ${a.versions_of}` : '';
    lines.push(
      `  ${written.has(a.id) ? '+' : ' '} ${a.id}  ${a.kind.padEnd(5)} ` +
        `${a.role.padEnd(12)} ${a.extracted.status.padEnd(11)} ${a.path}${version}`,
    );
  }
  if (result.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const w of result.warnings) lines.push(`  - ${w}`);
  }
  return lines.join('\n') + '\n';
}

export async function runIngest({ positionals, flags, deps }) {
  const positionalPaths = positionals.slice(1);
  const paths = positionalPaths.length
    ? positionalPaths
    : flags.paths.length
      ? flags.paths
      : undefined;

  return ingest(
    {
      store: deps.store,
      fs: deps.fs,
      parsers: deps.parsers,
      clock: deps.clock,
      actor: deps.actor,
    },
    { paths, force: flags.force },
  );
}

export default async function ingestCommand(ctx) {
  const result = await runIngest(ctx);
  return { text: renderIngest(result), json: result };
}

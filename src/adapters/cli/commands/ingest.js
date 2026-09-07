import { ingest } from '../../../application/ingest.js';

export function renderIngest(result) {
  const lines = [
    `Ingested ${result.artifacts.length} artifact(s), ${result.skipped.length} unchanged.`,
  ];
  for (const a of result.artifacts) {
    const chars = a.extracted?.text_chars ?? 0;
    lines.push(`  ${a.id}  ${a.kind.padEnd(5)} ${a.path} (${a.extracted?.status}, ${chars} chars)`);
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

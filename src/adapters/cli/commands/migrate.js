import { migrate } from '../../../application/migrate.js';

function render(result) {
  if (result.steps.length === 0) return `Workspace is up to date (${result.to})\n`;

  const verb = result.dryRun ? 'would change' : 'changed';
  const lines = [
    result.dryRun
      ? `Dry run: ${result.from} → ${result.to}, nothing was written`
      : `Migrated workspace ${result.from} → ${result.to}`,
  ];
  for (const step of result.steps) {
    lines.push(`  ${step.from} → ${step.to}: ${step.description}`);
    if (step.changed.length === 0) lines.push('    (no files)');
    for (const path of step.changed) lines.push(`    ${verb} ${path}`);
  }
  return lines.join('\n') + '\n';
}

export default async function migrateCommand({ flags, deps }) {
  const result = await migrate(
    { store: deps.store, git: deps.git, clock: deps.clock, actor: deps.actor },
    { dryRun: flags.dryRun, force: flags.force },
  );
  return { text: render(result), json: result };
}

import { doctor } from '../../../application/doctor.js';

function yesNo(value) {
  return value ? 'yes' : 'no';
}

function render(report) {
  const parsers = Object.entries(report.parsers)
    .map(([name, ok]) => `${name}=${yesNo(ok)}`)
    .join(', ');
  const versions = Object.entries(report.schemaVersions)
    .map(([type, v]) => `${type}=${v}`)
    .join(', ');

  const lines = [
    `node:              ${report.node}`,
    `git:               ${yesNo(report.git)}`,
    `pdftotext:         ${yesNo(report.pdftotext)}`,
    `workspace:         ${report.workspace ? 'phdude.yaml found' : 'not a PhDude workspace'}`,
  ];

  if (report.workspaceVersion !== null) {
    const note =
      report.workspaceVersion > report.workspaceVersionCurrent
        ? '(newer than this phdude)'
        : report.workspaceVersion === report.workspaceVersionCurrent
          ? '(current)'
          : `(needs migration → ${report.workspaceVersionCurrent})`;
    lines.push(`workspace version: ${report.workspaceVersion} ${note}`);
  }

  lines.push(`parsers:           ${parsers}`);

  // A policy that could not be read has no network setting and no provider list to report, and
  // printing the built-in defaults here would answer the question with a fiction.
  if (report.policyError) {
    lines.push(`policy:            unreadable (${report.policyError})`);
  } else {
    lines.push(
      `network:           ${report.network ? 'enabled' : 'disabled'}`,
      `providers:         ${report.providers.join(', ')}`,
      `execution:         ${report.execution.enabled ? 'enabled' : 'disabled'} (runtimes: ${report.execution.runtimes.join(', ')}; timeout ${report.execution.timeoutSeconds}s)`,
    );
  }

  lines.push(
    `cache entries:     ${report.cacheEntries}`,
    `packs available:   ${report.packsAvailable.length ? report.packsAvailable.join(', ') : '(none)'}`,
    `schema versions:   ${versions}`,
  );

  if (report.manuscript) {
    const counts = Object.entries(report.manuscript.counts)
      .map(([name, n]) => `${name}=${n}`)
      .join(', ');
    const reports = report.manuscript.reports;
    lines.push(
      '',
      'Manuscript:',
      `  sections:        ${counts}`,
      `  reports:         ${reports.length ? reports.join(', ') : '(none)'}`,
      `  drift:           ${report.manuscript.drifted.length ? report.manuscript.drifted.join(', ') : 'none'}`,
    );
  }

  if (report.skills.length > 0) {
    lines.push('', 'Skills:');
    for (const skill of report.skills) {
      lines.push(
        `  ${skill.name} (${skill.source}) network=${skill.permissions.network} workspace=${skill.permissions.workspace.join(',')}`,
      );
      for (const w of skill.warnings) lines.push(`    - ${w}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }

  return lines.join('\n') + '\n';
}

export default async function doctorCommand({ deps }) {
  const report = await doctor({
    store: deps.store,
    git: deps.git,
    parsers: deps.parserAdapters,
    loadPacks: deps.loadPacks,
    schemaTypes: deps.schemaTypes,
    node: deps.node,
    discoverSkills: deps.discoverSkills,
    skillsDir: deps.skillsDir,
  });
  return { text: render(report), json: report };
}

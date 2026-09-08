import * as build from '../../../application/build.js';

const LABEL_WIDTH = 'references'.length;

function row(label, value) {
  return `  ${label.padEnd(LABEL_WIDTH)}  ${value}`;
}

function renderWarnings(lines, warnings) {
  for (const warning of warnings) lines.push(`  ! ${warning}`);
}

function render(result) {
  const lines = [];

  if (!result.built) {
    lines.push(`${result.output.path} is up to date`);
    renderWarnings(lines, result.warnings);
    lines.push('', 'phdude build --force builds it anyway.');
    return lines.join('\n') + '\n';
  }

  lines.push(`Built ${result.output.path}`);
  lines.push(row('profile', result.profile));
  lines.push(row('renderer', result.renderer));
  lines.push(row('sections', result.sections.join(', ')));
  lines.push(row('references', result.bib));
  for (const figure of result.figures) lines.push(row('figure', figure));
  renderWarnings(lines, result.warnings);
  return lines.join('\n') + '\n';
}

export default async function buildCommand({ flags, deps }) {
  const result = await build.build(
    {
      store: deps.store,
      clock: deps.clock,
      actor: deps.actor,
      renderers: deps.renderers,
      loadProfile: deps.loadProfile,
      svgConvert: deps.svgConvert,
    },
    {
      format: flags.format,
      profile: flags.profile,
      sections: flags.sections,
      force: flags.force,
      includeDrafts: flags.includeDrafts,
    },
  );

  return { text: render(result), json: result };
}

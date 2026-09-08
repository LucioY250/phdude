import * as template from '../../../application/template.js';
import { PhdudeError } from '../../../domain/errors.js';

function renderList(templates) {
  if (templates.length === 0) {
    return '(no templates)\nRegister one with phdude template add <path>\n';
  }
  const width = Math.max(...templates.map((t) => t.name.length));
  const lines = templates.map((t) => {
    const bound = t.for ? `  for ${t.for}` : '';
    return `${t.name.padEnd(width)}  ${t.kind.padEnd(5)}  ${t.path}${bound}`;
  });
  lines.push('', `${templates.length} template(s)`);
  return lines.join('\n') + '\n';
}

function renderCheck(report) {
  const { template: found } = report;
  const lines = [`${found.name}  ${found.kind}  ${found.path}`];
  if (!report.hashMatches) {
    lines.push('  - the file has changed since it was registered');
    lines.push('    run phdude template add to record it again');
  }
  if (!report.checked) {
    lines.push(`  - ${report.reason}`);
  } else {
    for (const style of report.missing) lines.push(`  - missing style: ${style}`);
  }
  lines.push('', report.ok ? 'ok' : `${found.name} is not ready to render with`);
  return lines.join('\n') + '\n';
}

export default async function templateCommand({ sub, positionals, flags, deps }) {
  const storeDeps = { store: deps.store };

  if (sub === 'list' || sub === null) {
    const templates = await template.list(storeDeps);
    return { text: renderList(templates), json: templates };
  }

  if (sub === 'add') {
    const path = positionals[2];
    if (!path) {
      throw new PhdudeError(
        'USAGE',
        'template add needs a path',
        'phdude template add templates/university/thesis.docx [--kind docx|pptx|latex]',
      );
    }
    const result = await template.add(
      {
        store: deps.store,
        clock: deps.clock,
        actor: deps.actor,
        readBytes: deps.readBytes,
        realpath: deps.fs.realpath,
      },
      path,
      { kind: flags.kind },
    );
    const what = result.created ? 'Registered' : result.changed ? 'Updated' : 'Unchanged';
    return {
      text: `${what} ${result.template.name} (${result.template.kind} → ${result.template.path})\n`,
      json: result,
    };
  }

  if (sub === 'use') {
    const name = positionals[2];
    if (!name || !flags.for) {
      throw new PhdudeError(
        'USAGE',
        'template use needs a name and a profile',
        'phdude template use <name> --for <profile>',
      );
    }
    const result = await template.use(
      { store: deps.store, clock: deps.clock, actor: deps.actor },
      name,
      { profile: flags.for },
    );
    const text = result.changed
      ? `${result.template.name} is the ${result.template.kind} template for ${flags.for}\n`
      : `${result.template.name} was already the ${result.template.kind} template for ${flags.for}\n`;
    return { text, json: result };
  }

  if (sub === 'check') {
    const name = positionals[2];
    if (!name) {
      throw new PhdudeError('USAGE', 'template check needs a name', 'phdude template check <name>');
    }
    const report = await template.check(
      { store: deps.store, readBytes: deps.readBytes, ooxmlStyles: deps.ooxmlStyles },
      name,
    );
    return { text: renderCheck(report), json: report, exitCode: report.ok ? 0 : 2 };
  }

  throw new PhdudeError(
    'USAGE',
    `unknown template subcommand: ${sub}`,
    'phdude template list | add <path> | use <name> --for <profile> | check <name>',
  );
}

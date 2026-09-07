import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as manuscript from '../../../application/manuscript.js';
import { PhdudeError } from '../../../domain/errors.js';

function requireSection(positionals, sub) {
  const section = positionals[2];
  if (!section) {
    throw new PhdudeError(
      'USAGE',
      `manuscript ${sub} needs a section`,
      `phdude manuscript ${sub} <section>`,
    );
  }
  return section;
}

function renderSectionRow(entry) {
  const approved = entry.approved_by ? `  approved by ${entry.approved_by}` : '';
  return `  ${String(entry.order).padStart(2)} ${entry.id.padEnd(14)} ${entry.status.padEnd(9)} ${entry.file}${approved}`;
}

function renderVoice(voice) {
  return voice.kind === 'author' ? voice.author : 'project-consensus';
}

async function init({ flags, deps }) {
  const result = await manuscript.init(deps, {
    title: flags.title,
    language: flags.language,
    voice: flags.voice,
  });
  const lines = [
    `Manuscript: ${result.title} (${result.language}, voice ${renderVoice(result.voice)})`,
    '',
    ...result.sections.map(renderSectionRow),
    '',
    `${result.sections.length} section(s) planned; no section file is written until you submit one.`,
  ];
  return { text: lines.join('\n') + '\n', json: result };
}

async function list({ deps }) {
  const sections = await manuscript.list(deps);
  return { text: sections.map(renderSectionRow).join('\n') + '\n', json: sections };
}

async function show({ positionals, deps }) {
  const section = requireSection(positionals, 'show');
  const result = await manuscript.show(deps, section);
  const lines = [
    `${result.id} (${result.status})  ${result.title}`,
    `  file: ${result.file}`,
    `  hash: ${result.hash ?? '(none)'}`,
  ];
  if (result.approved_by) lines.push(`  approved by: ${result.approved_by}`);
  lines.push('', result.body ?? '(nothing written yet)');
  return { text: lines.join('\n') + '\n', json: result };
}

async function status({ deps }) {
  const report = await manuscript.status(deps);
  const counts = Object.entries(report.counts)
    .map(([name, n]) => `${name}=${n}`)
    .join(', ');
  const lines = [
    `Manuscript: ${report.title} (${report.language}, voice ${renderVoice(report.voice)})`,
    `Sections: ${counts}`,
    '',
    ...report.sections.map(renderSectionRow),
  ];
  return { text: lines.join('\n') + '\n', json: report };
}

async function submit({ positionals, flags, deps }) {
  const section = requireSection(positionals, 'submit');
  const result = await manuscript.submit(deps, {
    section,
    file: flags.file,
    revision: flags.revision,
  });
  const lines = [`Submitted ${result.section.id} (${result.section.status})`, `  ${result.path}`];
  for (const finding of result.findings) {
    lines.push(`  ${finding.severity} ${finding.gate}:${finding.line} ${finding.message}`);
  }
  lines.push(`  gates: ${result.report.gates.map((g) => g.gate).join(', ')}`);
  return { text: lines.join('\n') + '\n', json: result };
}

async function approve({ positionals, flags, deps }) {
  const section = requireSection(positionals, 'approve');
  const result = await manuscript.approve(deps, { section, decision: flags.decision });
  return {
    text: `Approved ${result.section.id} by ${result.decision}\n`,
    json: result,
  };
}

async function reopen({ positionals, deps }) {
  const section = requireSection(positionals, 'reopen');
  const result = await manuscript.reopen(deps, { section });
  return { text: `Reopened ${result.section.id} (${result.section.status})\n`, json: result };
}

const SUBS = { init, list, show, status, submit, approve, reopen };

export default async function manuscriptCommand(ctx) {
  const handler = SUBS[ctx.sub];
  if (!handler) {
    throw new PhdudeError(
      'USAGE',
      `unknown manuscript sub-command: ${ctx.sub ?? '(none)'}`,
      `valid sub-commands: ${Object.keys(SUBS).join(', ')}`,
    );
  }
  return handler({
    ...ctx,
    deps: {
      store: ctx.deps.store,
      clock: ctx.deps.clock,
      actor: ctx.deps.actor,
      // The draft is a file the agent just wrote next to its own working directory, not a
      // workspace object, so it is read relative to the shell's cwd rather than the store.
      readText: async (path) => {
        try {
          return await readFile(resolve(ctx.cwd, path), 'utf8');
        } catch (err) {
          if (err.code === 'ENOENT' || err.code === 'EISDIR') return null;
          throw err;
        }
      },
    },
  });
}

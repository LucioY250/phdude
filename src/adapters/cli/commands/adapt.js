import * as adaptUseCase from '../../../application/adapt.js';

const NONE = '—';

function pad(values) {
  const width = Math.max(0, ...values.map((value) => value.length));
  return (value) => value.padEnd(width);
}

function renderMapping(mapping) {
  const froms = pad(mapping.map((row) => row.from ?? NONE));
  const tos = pad(mapping.map((row) => row.to ?? NONE));
  return mapping.map(
    (row) => `  ${froms(row.from ?? NONE)} → ${tos(row.to ?? NONE)}  ${row.reason}`,
  );
}

function overBy(delta) {
  return delta > 0 ? `${delta} over` : delta === 0 ? 'exactly at the limit' : `${-delta} to spare`;
}

function renderLimits(limits) {
  const names = pad(limits.map((limit) => limit.section));
  return limits.map(
    (limit) =>
      `  ${names(limit.section)}  ${limit.words} / ${limit.max} words  ${overBy(limit.delta)}`,
  );
}

function renderAbstract(abstract) {
  if (abstract.to === null) return [];
  if (abstract.section === null || abstract.words === null) {
    return [`  the abstract limit becomes ${abstract.to} words; the manuscript has none written`];
  }
  const from = abstract.from === null ? '' : ` (was ${abstract.from})`;
  return [`  ${abstract.words} / ${abstract.to} words${from}  ${overBy(abstract.delta)}`];
}

function block(title, lines) {
  return lines.length === 0 ? [] : ['', title, ...lines];
}

function renderPlan(result) {
  const { plan } = result;
  const lines = [`${result.from} → ${result.to}`];

  lines.push(...block('Sections', renderMapping(plan.mapping)));
  lines.push(...block('Word limits', renderLimits(plan.limits)));
  lines.push(...block('Abstract', renderAbstract(plan.abstract)));
  lines.push(
    ...block(
      'Figures',
      plan.figures.map((figure) => `  ${figure.id}  ${figure.from} → ${figure.to}`),
    ),
  );
  lines.push(
    ...block(
      'Terminology',
      plan.terminology.map((term) => `  ${term.from} → ${term.to}  (${term.hits} in the prose)`),
    ),
  );

  if (plan.citation_style.from !== plan.citation_style.to) {
    lines.push('', `Citation style: ${plan.citation_style.from} → ${plan.citation_style.to}`);
  }

  lines.push('');
  if (result.applied) {
    lines.push(`Wrote ${result.path}`);
  } else if (result.reason === 'up to date') {
    lines.push(`${result.path} already says exactly this; nothing was written.`);
  } else {
    lines.push(`Nothing was written. --apply writes ${result.path}.`);
  }

  if (result.revised.length > 0) {
    lines.push(
      `Over the limit, and marked revised: ${result.revised.join(', ')}. ` +
        'Take each one back through phdude deslop or phdude write.',
    );
  }

  const undecided = plan.mapping.filter((row) => row.to === null).length;
  if (undecided > 0) {
    lines.push(
      `${undecided} section(s) need a decision: ${result.to} has no place for them, and ` +
        'they were carried over as they are.',
    );
  }

  return lines.join('\n') + '\n';
}

export default async function adaptCommand({ flags, deps }) {
  const result = await adaptUseCase.adapt(
    {
      store: deps.store,
      clock: deps.clock,
      actor: deps.actor,
      loadProfile: deps.loadProfile,
    },
    { to: flags.to, apply: flags.apply },
  );
  return { text: renderPlan(result), json: result };
}

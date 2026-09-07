import * as decide from '../../../application/decide.js';
import { PhdudeError } from '../../../domain/errors.js';
import { parseJsonArg } from '../args.js';

// `supersede` needs the replacing decision as well as the researcher who decided.
const EXTRA_HINT = { supersede: ' --with <DEC-id>' };

function requireId(positionals, sub) {
  const id = positionals[2];
  if (!id) {
    throw new PhdudeError(
      'USAGE',
      `decide ${sub} needs a decision id`,
      `phdude decide ${sub} <DEC-id> --by <name>${EXTRA_HINT[sub] ?? ''}`,
    );
  }
  return id;
}

function renderDecision(verb, obj) {
  const lines = [`${verb} ${obj.id} (${obj.status})`, `  ${obj.title}`];
  if (obj.affects.length > 0) lines.push(`  affects: ${obj.affects.join(', ')}`);
  if (obj.approved_by.length > 0) lines.push(`  approved by: ${obj.approved_by.join(', ')}`);
  return lines.join('\n') + '\n';
}

async function propose({ flags, deps }) {
  if (!flags.title) {
    throw new PhdudeError(
      'USAGE',
      'decide propose needs --title',
      'phdude decide propose --title "…" --rationale "…"',
    );
  }
  if (!flags.rationale) {
    throw new PhdudeError(
      'USAGE',
      'decide propose needs --rationale',
      'explain why this decision is being proposed',
    );
  }
  const change = flags.change === undefined ? {} : parseJsonArg(flags.change, '--change');
  const { obj, created } = await decide.propose(deps, {
    title: flags.title,
    rationale: flags.rationale,
    affects: flags.affects,
    change,
  });
  return { text: renderDecision(created ? 'Proposed' : 'Unchanged', obj), json: obj };
}

async function approve({ positionals, flags, deps }) {
  const id = requireId(positionals, 'approve');
  const obj = await decide.approve(deps, id, { by: flags.by });
  return { text: renderDecision('Approved', obj), json: obj };
}

async function reject({ positionals, flags, deps }) {
  const id = requireId(positionals, 'reject');
  const obj = await decide.reject(deps, id, { by: flags.by, reason: flags.reason });
  return { text: renderDecision('Rejected', obj), json: obj };
}

async function supersede({ positionals, flags, deps }) {
  const id = requireId(positionals, 'supersede');
  const obj = await decide.supersede(deps, id, { by: flags.by, with: flags.with });
  return { text: renderDecision('Superseded', obj), json: obj };
}

const SUBS = { propose, approve, reject, supersede };

export default async function decideCommand(ctx) {
  const handler = SUBS[ctx.sub];
  if (!handler) {
    throw new PhdudeError(
      'USAGE',
      `unknown decide sub-command: ${ctx.sub ?? '(none)'}`,
      `valid sub-commands: ${Object.keys(SUBS).join(', ')}`,
    );
  }
  return handler({
    ...ctx,
    deps: { store: ctx.deps.store, clock: ctx.deps.clock, actor: ctx.deps.actor },
  });
}

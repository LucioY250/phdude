import { parseArgs } from 'node:util';
import { PhdudeError } from '../../domain/errors.js';

// Options every command accepts: output, workspace selection, the recorded actor, the two
// payload carriers and the two switches that mean the same thing everywhere.
export const GLOBAL_OPTIONS = {
  json: { type: 'boolean' },
  workspace: { type: 'string' },
  actor: { type: 'string' },
  file: { type: 'string' },
  force: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

// What each command accepts on top of the global options. A flag missing from this table is a
// usage error rather than a silently ignored typo, which matters most for an agent: `--stat
// candidate` would otherwise return the unfiltered list and be read as an answer.
export const COMMAND_OPTIONS = {
  init: {
    title: { type: 'string' },
    agents: { type: 'string' },
    'no-git': { type: 'boolean' },
  },
  bootstrap: {},
  ingest: { paths: { type: 'string', multiple: true } },
  status: {},
  next: {},
  knowledge: {
    type: { type: 'string' },
    state: { type: 'string' },
    query: { type: 'string' },
    id: { type: 'string' },
  },
  add: {},
  link: { to: { type: 'string', multiple: true }, id: { type: 'string' } },
  decide: {
    title: { type: 'string' },
    rationale: { type: 'string' },
    affects: { type: 'string', multiple: true },
    change: { type: 'string' },
    by: { type: 'string' },
    reason: { type: 'string' },
    with: { type: 'string' },
  },
  promote: {
    to: { type: 'string' },
    decision: { type: 'string' },
    id: { type: 'string' },
  },
  packs: {},
  mode: {},
  migrate: {},
  doctor: {},
  help: {},
};

/**
 * @param {string|null} command
 * @returns {object} the parseArgs option table for `command`, globals included
 */
export function optionsFor(command) {
  return { ...GLOBAL_OPTIONS, ...(COMMAND_OPTIONS[command] ?? {}) };
}

// Every option any command takes. Only the first, lenient pass uses it: it has to consume
// option values the way the real pass will, or a flag written before the command name would
// turn its value into the "command" (`phdude --type claim knowledge list`).
const EVERY_OPTION = Object.values(COMMAND_OPTIONS).reduce(
  (all, options) => ({ ...options, ...all }),
  { ...GLOBAL_OPTIONS },
);

function looksLikeJson(token) {
  return token.startsWith('{') || token.startsWith('[');
}

// `--json` is both the global output flag and the payload carrier for `phdude add` /
// `phdude decide propose`. node:util.parseArgs cannot express that, so it and the variadic
// `--affects ID…` form are lifted out before parseArgs runs. `phdude link` takes `--to ID…`
// the same way; every other command's `--to` is a single value (`promote --to <state>`) and
// must stay one, or the flag swallows the id that follows it.
function preprocess(argv, variadicTo) {
  const rest = [];
  const affects = [];
  const to = [];
  let json = false;
  let jsonPayload = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
      const next = argv[i + 1];
      if (next !== undefined && looksLikeJson(next)) {
        jsonPayload = next;
        i++;
      }
    } else if (arg.startsWith('--json=')) {
      json = true;
      const value = arg.slice('--json='.length);
      if (looksLikeJson(value)) jsonPayload = value;
    } else if (arg === '--affects' || (variadicTo && arg === '--to')) {
      const target = arg === '--to' ? to : affects;
      let j = i + 1;
      while (j < argv.length && !argv[j].startsWith('-')) {
        target.push(argv[j]);
        j++;
      }
      i = j - 1;
    } else if (arg.startsWith('--affects=')) {
      affects.push(arg.slice('--affects='.length));
    } else if (variadicTo && arg.startsWith('--to=')) {
      to.push(arg.slice('--to='.length));
    } else {
      rest.push(arg);
    }
  }

  return { rest, json, jsonPayload, affects, to };
}

function parseActor(value) {
  if (value === undefined) return null;
  if (!value.includes('=')) return { researcher: value };
  const actor = {};
  for (const part of value.split(',')) {
    const [key, ...tail] = part.split('=');
    const name = key.trim();
    if (name === 'researcher' || name === 'agent') actor[name] = tail.join('=').trim();
  }
  return actor;
}

function parseList(value) {
  if (value === undefined) return null;
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * @param {string} text
 * @param {string} label - the flag the text came from, for the error message
 * @returns {object}
 */
export function parseJsonArg(text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new PhdudeError(
      'VALIDATION',
      `${label} is not valid JSON: ${err.message}`,
      `pass a quoted JSON object, e.g. ${label} '{"key":"value"}'`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PhdudeError('VALIDATION', `${label} must be a JSON object`, null);
  }
  return parsed;
}

function allowedList(options) {
  return `allowed: ${Object.keys(options)
    .sort()
    .map((name) => `--${name}`)
    .join(', ')}`;
}

function usageError(err, command, options) {
  const unknown = /Unknown option '(-[^']+)'/.exec(err.message);
  if (unknown) {
    throw new PhdudeError(
      'USAGE',
      `unknown option ${unknown[1]} for ${command}`,
      allowedList(options),
    );
  }
  throw new PhdudeError('USAGE', err.message, 'run phdude help');
}

function build(argv, { variadicTo = false, command = null, strict = false } = {}) {
  const { rest, json, jsonPayload, affects, to } = preprocess(argv, variadicTo);
  const options = strict ? optionsFor(command) : EVERY_OPTION;

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      // The variadic flags never reach parseArgs (preprocess lifts them out), but they stay in
      // the table so the "allowed" hint lists every flag the command really takes.
      options: Object.fromEntries(
        Object.entries(options).filter(
          ([name]) => name !== 'affects' && !(variadicTo && name === 'to'),
        ),
      ),
      allowPositionals: true,
      strict,
    });
  } catch (err) {
    usageError(err, command, options);
  }

  const { values, positionals } = parsed;

  return {
    command: positionals[0] ?? null,
    sub: positionals[1] ?? null,
    positionals,
    flags: {
      json,
      jsonPayload,
      affects,
      actor: parseActor(values.actor),
      agents: parseList(values.agents),
      paths: values.paths ?? [],
      workspace: values.workspace,
      force: values.force === true,
      title: values.title,
      type: values.type,
      state: values.state,
      query: values.query,
      by: values.by,
      with: values.with,
      decision: values.decision,
      to: variadicTo ? to : values.to,
      file: values.file,
      rationale: values.rationale,
      reason: values.reason,
      id: values.id,
      change: values.change,
      noGit: values['no-git'] === true,
      dryRun: values['dry-run'] === true,
      help: values.help === true,
      version: values.version === true,
    },
  };
}

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{command: string|null, sub: string|null, positionals: string[], flags: object}}
 */
export function parseCli(argv) {
  // Which command it is decides both how `--to` is parsed and which options are legal, and
  // only parsing tells us the command, so a lenient pass runs first and the real one follows.
  // An unrecognised command is parsed leniently too, so `phdude frobnicate --x` reports the
  // command rather than the flag.
  const detected = build(argv);
  const command = detected.command;
  if (!Object.hasOwn(COMMAND_OPTIONS, command)) return detected;
  return build(argv, { variadicTo: command === 'link', command, strict: true });
}

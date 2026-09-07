import { parseArgs } from 'node:util';
import { PhdudeError } from '../../domain/errors.js';

const OPTIONS = {
  workspace: { type: 'string' },
  actor: { type: 'string' },
  force: { type: 'boolean' },
  title: { type: 'string' },
  agents: { type: 'string' },
  type: { type: 'string' },
  state: { type: 'string' },
  query: { type: 'string' },
  by: { type: 'string' },
  decision: { type: 'string' },
  file: { type: 'string' },
  rationale: { type: 'string' },
  reason: { type: 'string' },
  role: { type: 'string' },
  id: { type: 'string' },
  change: { type: 'string' },
  paths: { type: 'string', multiple: true },
  'no-git': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

function looksLikeJson(token) {
  return token.startsWith('{') || token.startsWith('[');
}

// `--json` is both the global output flag and the payload carrier for `phdude add` /
// `phdude decide propose`. node:util.parseArgs cannot express that, so both it and the
// variadic `--affects ID…` / `--to ID…` forms are lifted out before parseArgs runs.
function preprocess(argv) {
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
    } else if (arg === '--affects' || arg === '--to') {
      const target = arg === '--to' ? to : affects;
      let j = i + 1;
      while (j < argv.length && !argv[j].startsWith('-')) {
        target.push(argv[j]);
        j++;
      }
      i = j - 1;
    } else if (arg.startsWith('--affects=')) {
      affects.push(arg.slice('--affects='.length));
    } else if (arg.startsWith('--to=')) {
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

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{command: string|null, sub: string|null, positionals: string[], flags: object}}
 */
export function parseCli(argv) {
  const { rest, json, jsonPayload, affects, to } = preprocess(argv);

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: OPTIONS,
      allowPositionals: true,
      strict: false,
    });
  } catch (err) {
    throw new PhdudeError('USAGE', err.message, 'run phdude help');
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
      decision: values.decision,
      to,
      file: values.file,
      rationale: values.rationale,
      reason: values.reason,
      role: values.role,
      id: values.id,
      change: values.change,
      noGit: values['no-git'] === true,
      help: values.help === true,
      version: values.version === true,
    },
  };
}

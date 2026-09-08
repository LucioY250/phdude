#!/usr/bin/env node
// A thin wrapper over `phdude prose`, nothing more.
//
// The rules live in PhDude's core (`src/domain/prose-lint.js`) and are shared with the writing
// pipeline's prose gate. Once this skill is copied into a workspace under `.phdude/skills/` it
// can no longer import the package, so it runs the CLI instead of holding a second copy of the
// rules that could drift from the first.
//
// PhDude never measures or targets an AI-detector score (PRD §30c), so an option that names one
// is refused here as well as in the CLI.
import { execFile } from 'node:child_process';

const USAGE = 'usage: prose-lint.mjs <file> [--lang <code>] [--json]';
const REFUSED = /detect|humaniz/i;
const EXIT = { USAGE: 1, POLICY: 3, TOOL_MISSING: 4 };

function fail(code, message, hint) {
  process.stderr.write(`${message}\n`);
  if (hint) process.stderr.write(`Suggested action: ${hint}\n`);
  process.exit(code);
}

function parse(argv) {
  const options = [];
  let file = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2).split('=')[0];
      if (REFUSED.test(name)) {
        fail(
          EXIT.POLICY,
          'PhDude does not measure or target AI-detector scores',
          'see PRD §30c: the goal is better academic prose, not detector evasion',
        );
      }
      if (name === 'json') {
        options.push('--json');
        continue;
      }
      if (name === 'lang') {
        const value = arg.includes('=') ? arg.split('=').slice(1).join('=') : argv[++i];
        if (!value) fail(EXIT.USAGE, '--lang needs a language code', USAGE);
        options.push('--lang', value);
        continue;
      }
      fail(EXIT.USAGE, `unknown option ${arg}`, USAGE);
    }
    if (file !== null) fail(EXIT.USAGE, 'lint one file at a time', USAGE);
    file = arg;
  }

  if (file === null) fail(EXIT.USAGE, 'no file given', USAGE);
  return { file, options };
}

const { file, options } = parse(process.argv.slice(2));

execFile(
  'phdude',
  ['prose', '--file', file, ...options],
  { maxBuffer: 32 * 1024 * 1024 },
  (err, stdout, stderr) => {
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    if (err && err.code === 'ENOENT') {
      fail(
        EXIT.TOOL_MISSING,
        'phdude is not on PATH',
        'install PhDude (npm install -g phdude), or run: npx phdude prose --file <file>',
      );
    }
    process.exit(err ? (typeof err.code === 'number' ? err.code : 1) : 0);
  },
);

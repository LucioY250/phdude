import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { PhdudeError, exitCodeFor } from '../../domain/errors.js';
import { SCHEMA_TYPES } from '../../schemas/index.js';
import { gitAdapter } from '../git.js';
import { detectKind, parserFor, PARSERS } from '../documents/index.js';
import { DEFAULT_PACKS_DIR, discoverPacks } from '../packs/loader.js';
import { FsStore } from '../store/fs-store.js';
import { read, walk } from '../store/fs-walk.js';
import { parseCli } from './args.js';
import { printJson } from './output.js';
import add from './commands/add.js';
import bootstrap from './commands/bootstrap.js';
import decide from './commands/decide.js';
import doctor from './commands/doctor.js';
import help, { usage } from './commands/help.js';
import ingest from './commands/ingest.js';
import init from './commands/init.js';
import knowledge from './commands/knowledge.js';
import link from './commands/link.js';
import migrate from './commands/migrate.js';
import mode from './commands/mode.js';
import next from './commands/next.js';
import packs from './commands/packs.js';
import promote from './commands/promote.js';
import status from './commands/status.js';

const { version } = createRequire(import.meta.url)('../../../package.json');

const COMMANDS = {
  add,
  bootstrap,
  decide,
  doctor,
  ingest,
  init,
  knowledge,
  link,
  migrate,
  mode,
  next,
  packs,
  promote,
  status,
};

function workspaceFor(cli, cwd) {
  if (cli.flags.workspace) return resolve(cwd, cli.flags.workspace);
  if (cli.command === 'init' && cli.positionals[1]) return resolve(cwd, cli.positionals[1]);
  return resolve(cwd, '.');
}

async function buildContext(cli, { cwd, env, stdout, stderr }) {
  const workspace = workspaceFor(cli, cwd);
  // `init` is the one command allowed to create its own workspace directory, and it has to
  // exist before git can be asked who the researcher is.
  if (cli.command === 'init') await mkdir(workspace, { recursive: true });

  const store = new FsStore(workspace);
  const actor = {
    researcher:
      cli.flags.actor?.researcher ??
      (await gitAdapter.userName(workspace)) ??
      env.USER ??
      'unknown',
    agent: cli.flags.actor?.agent ?? env.PHDUDE_AGENT ?? 'cli',
  };

  const deps = {
    store,
    git: gitAdapter,
    fs: { walk, read },
    parsers: { detectKind, parserFor },
    parserAdapters: PARSERS,
    loadPacks: () => discoverPacks([DEFAULT_PACKS_DIR, join(workspace, '.phdude', 'packs')]),
    clock: () => new Date().toISOString(),
    actor,
    schemaTypes: SCHEMA_TYPES,
    node: process.version,
  };

  return { ...cli, deps, workspace, cwd, env, stdout, stderr };
}

function writeError(err, { stderr, json, env }) {
  if (err instanceof PhdudeError) {
    if (json) {
      stderr.write(
        printJson({
          error: { code: err.code, message: err.message, hint: err.hint, details: err.details },
        }) + '\n',
      );
    } else {
      stderr.write(`${err.message}\n`);
      if (err.hint) stderr.write(`Suggested action: ${err.hint}\n`);
      for (const detail of err.details ?? []) stderr.write(`  - ${detail}\n`);
    }
    return exitCodeFor(err);
  }

  if (json) {
    stderr.write(printJson({ error: { code: 'INTERNAL', message: err.message } }) + '\n');
  } else {
    stderr.write(`${err.message}\n`);
  }
  // Never show a stack trace to a researcher; PHDUDE_DEBUG=1 brings it back for maintainers.
  if (env?.PHDUDE_DEBUG === '1') stderr.write(`${err.stack}\n`);
  return 1;
}

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @param {{stdout: object, stderr: object, cwd: string, env: object}} io
 * @returns {Promise<number>} the process exit code
 */
export async function run(argv, { stdout, stderr, cwd, env }) {
  // Resolved before parseCli so that a parse failure, a bare invocation and an unknown
  // command all honour the --json error contract too.
  const json = argv.some((a) => a === '--json' || a.startsWith('--json='));

  // Usage failures reach the same writer as every other error; humans additionally get the
  // usage block, which would be noise inside a JSON stream.
  const usageFailure = (message) => {
    const code = writeError(new PhdudeError('USAGE', message, 'run phdude help'), {
      stderr,
      json,
      env,
    });
    if (!json) stderr.write(`\n${usage()}`);
    return code;
  };

  try {
    const cli = parseCli(argv);

    if (cli.flags.version) {
      stdout.write(`phdude ${version}\n`);
      return 0;
    }

    if (cli.command === null && !cli.flags.help) return usageFailure('no command given');

    if (cli.flags.help || cli.command === 'help') {
      const result = await help();
      stdout.write(json ? printJson(result.json) + '\n' : result.text);
      return 0;
    }

    const handler = COMMANDS[cli.command];
    if (!handler) return usageFailure(`unknown command "${cli.command}"`);

    const result = await handler(await buildContext(cli, { cwd, env, stdout, stderr }));

    if (json) {
      stdout.write(printJson(result.json) + '\n');
    } else if (result.text) {
      stdout.write(result.text.endsWith('\n') ? result.text : `${result.text}\n`);
    }
    return 0;
  } catch (err) {
    return writeError(err, { stderr, json, env });
  }
}

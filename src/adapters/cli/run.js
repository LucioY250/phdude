import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { PhdudeError, exitCodeFor } from '../../domain/errors.js';
import { SCHEMA_TYPES } from '../../schemas/index.js';
import { gitAdapter } from '../git.js';
import { detectKind, parseTable, parserFor, PARSERS } from '../documents/index.js';
import { ooxmlStyleNames } from '../documents/ooxml.js';
import { writeXlsx } from '../render/xlsx.js';
import {
  DEFAULT_PACKS_DIR,
  discoverPacks,
  discoverProfiles,
  loadProfile,
} from '../packs/loader.js';
import { localRunner } from '../execution/local.js';
import { DEFAULT_GENERATORS_DIR } from '../execution/generators.js';
import { buildRenderers } from '../render/index.js';
import { svgConverter } from '../render/svg.js';
import { buildProviders } from '../search/index.js';
import { fakeFetchFromFile } from '../search/fake-fetch.js';
import { DEFAULT_SKILLS_DIR } from '../agents/shared.js';
import { discoverSkills, loadSkill } from '../skills/loader.js';
import { providerNames } from '../../domain/policy.js';
import { FsStore } from '../store/fs-store.js';
import { read, realpath, walk } from '../store/fs-walk.js';
import { parseCli } from './args.js';
import { printJson } from './output.js';
import adapt from './commands/adapt.js';
import add from './commands/add.js';
import analyze from './commands/analyze.js';
import authors from './commands/authors.js';
import bootstrap from './commands/bootstrap.js';
import buildCommand from './commands/build.js';
import cite from './commands/cite.js';
import data from './commands/data.js';
import decide from './commands/decide.js';
import deslop from './commands/deslop.js';
import doctor from './commands/doctor.js';
import edit from './commands/edit.js';
import figure from './commands/figure.js';
import freshness from './commands/freshness.js';
import gaps from './commands/gaps.js';
import health from './commands/health.js';
import help, { usage } from './commands/help.js';
import ingest from './commands/ingest.js';
import init from './commands/init.js';
import knowledge from './commands/knowledge.js';
import link from './commands/link.js';
import manuscript from './commands/manuscript.js';
import matrix from './commands/matrix.js';
import migrate from './commands/migrate.js';
import mode from './commands/mode.js';
import next from './commands/next.js';
import packs from './commands/packs.js';
import profileCommand from './commands/profile.js';
import present from './commands/present.js';
import promote from './commands/promote.js';
import prose from './commands/prose.js';
import repro from './commands/repro.js';
import research from './commands/research.js';
import researchFresh from './commands/research-fresh.js';
import status from './commands/status.js';
import table from './commands/table.js';
import template from './commands/template.js';
import write from './commands/write.js';

const { version } = createRequire(import.meta.url)('../../../package.json');

const COMMANDS = {
  adapt,
  add,
  analyze,
  authors,
  bootstrap,
  build: buildCommand,
  cite,
  data,
  decide,
  deslop,
  doctor,
  edit,
  figure,
  freshness,
  gaps,
  health,
  ingest,
  init,
  knowledge,
  link,
  manuscript,
  matrix,
  migrate,
  mode,
  next,
  packs,
  profile: profileCommand,
  present,
  promote,
  prose,
  repro,
  research,
  'research-fresh': researchFresh,
  status,
  table,
  template,
  write,
};

// The commands allowed to reach a search provider. Only these pay for reading the research
// policy and building the provider list, and only these can ever hold a `fetch`.
const NETWORK_COMMANDS = new Set(['research', 'research-fresh']);

// Test-only hook: with PHDUDE_FAKE_FETCH set to a JSON routes file, every provider talks to
// that file instead of the network. Documented under "Testing" in docs/cli.md; nothing in a
// real run sets it.
async function fetchFor(env) {
  if (env.PHDUDE_FAKE_FETCH) return fakeFetchFromFile(env.PHDUDE_FAKE_FETCH);
  return globalThis.fetch;
}

// The providers this run may call: exactly what the policy lists. `--provider` is applied
// downstream, where it can only narrow this list - building it from the flag would let a flag
// reach a provider the workspace never named. `mailto` is the polite contact OpenAlex and
// Crossref ask for, taken from the author profile when the researcher recorded one (spec §3.1).
async function searchDeps(store, env, fetch) {
  const policy = await store.readYaml(join('.phdude', 'research-policy.yaml'));
  const profile = await store.readYaml(join('.phdude', 'author-profile.yaml'));
  const names = providerNames(policy);
  const mailto = typeof profile?.email === 'string' && profile.email.trim() ? profile.email : null;
  return buildProviders(names, { fetch, env, version, mailto });
}

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
    fs: { walk, read, realpath },
    parsers: { detectKind, parserFor },
    parserAdapters: PARSERS,
    ooxmlStyles: ooxmlStyleNames,
    writeXlsx,
    readBytes: (rel) => read(join(workspace, rel)),
    parseTable,
    runner: localRunner,
    renderers: buildRenderers({ execFile, env, version }),
    svgConvert: svgConverter({ execFile, env }),
    generatorsDir: DEFAULT_GENERATORS_DIR,
    loadPacks: () => discoverPacks([DEFAULT_PACKS_DIR, join(workspace, '.phdude', 'packs')]),
    loadProfile: (name) =>
      loadProfile(name, [DEFAULT_PACKS_DIR, join(workspace, '.phdude', 'packs')]),
    loadProfiles: () => discoverProfiles([DEFAULT_PACKS_DIR, join(workspace, '.phdude', 'packs')]),
    discoverSkills,
    loadSkill,
    skillsDir: DEFAULT_SKILLS_DIR,
    clock: () => new Date().toISOString(),
    actor,
    env,
    fetch: globalThis.fetch,
    schemaTypes: SCHEMA_TYPES,
    node: process.version,
  };

  if (NETWORK_COMMANDS.has(cli.command)) {
    deps.fetch = await fetchFor(env);
    deps.providers = await searchDeps(store, env, deps.fetch);
  }

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
      // The details come first: when they are a gate's findings, the researcher needs the
      // located list before the sentence that says how many there were (spec §3.4).
      for (const detail of err.details ?? []) stderr.write(`  - ${detail}\n`);
      stderr.write(`${err.message}\n`);
      if (err.hint) stderr.write(`Suggested action: ${err.hint}\n`);
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
    // A handler that succeeded (no PhdudeError thrown) but found something wrong - `cite
    // check`'s failed findings - still prints its full report rather than an error shape, so
    // it opts into a non-zero exit this way instead of throwing.
    return result.exitCode ?? 0;
  } catch (err) {
    return writeError(err, { stderr, json, env });
  }
}

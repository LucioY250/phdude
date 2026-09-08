import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_CODES } from '../../src/domain/errors.js';
import { COMMAND_OPTIONS } from '../../src/adapters/cli/args.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'phdude.js');
const ACTOR = ['--actor', 'researcher=tester,agent=contract'];

// The frozen envelope: an error is one `error` object carrying exactly these four keys, always on
// stderr, and `hint` and `details` are present as null rather than absent when there are none.
// A consumer that reads `error.details` gets null or an array, never `undefined`.
const ERROR_KEYS = ['code', 'message', 'hint', 'details'];

function phdude(cwd, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-json-shape-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const init = await phdude(root, ['init', '--title', 'Contract', '--no-git', ...ACTOR]);
  assert.equal(init.code, 0, init.stderr);
  return root;
}

function parseError(result) {
  assert.equal(result.stdout, '', 'an error writes nothing to stdout');
  const payload = JSON.parse(result.stderr);
  assert.deepEqual(Object.keys(payload), ['error'], 'the envelope is one "error" key');
  assert.deepEqual(
    Object.keys(payload.error).sort(),
    [...ERROR_KEYS].sort(),
    'the error object carries exactly code, message, hint and details',
  );
  const { code, message, hint, details } = payload.error;
  assert.equal(typeof code, 'string');
  assert.ok(message.length > 0, 'an error always says what happened');
  assert.ok(hint === null || (typeof hint === 'string' && hint.length > 0));
  assert.ok(details === null || Array.isArray(details));
  return payload.error;
}

async function declareAnalysis(root, name, script) {
  await mkdir(join(root, 'analysis'), { recursive: true });
  await writeFile(join(root, 'analysis', `${name}.mjs`), script);
  const added = await phdude(root, [
    'analyze',
    'add',
    '--json',
    JSON.stringify({ name, runtime: 'node', script: `analysis/${name}.mjs` }),
    ...ACTOR,
  ]);
  assert.equal(added.code, 0, added.stderr);
  return JSON.parse(added.stdout).analysis.id;
}

async function pointNodeAt(root, executable) {
  const path = join(root, '.phdude', 'research-policy.yaml');
  const policy = await readFile(path, 'utf8');
  const mapping = /^([ \t]*node: )node$/m;
  assert.match(policy, mapping, 'the default policy maps node to node');
  await writeFile(path, policy.replace(mapping, `$1${executable}`));
}

// Each case names the code it freezes and the smallest real invocation that raises it.
const CASES = {
  USAGE: {
    exit: 1,
    run: (root) => phdude(root, ['bogus-command', '--json']),
  },
  VALIDATION: {
    exit: 2,
    run: (root) => phdude(root, ['add', 'claim', '--json', '{', ...ACTOR]),
  },
  POLICY: {
    exit: 3,
    run: (root) => phdude(root, ['research', 'anything at all', '--json', ...ACTOR]),
  },
  TOOL_MISSING: {
    exit: 4,
    async run(root) {
      const id = await declareAnalysis(root, 'missing-runtime', 'process.exit(0);\n');
      await pointNodeAt(root, 'phdude-no-such-runtime');
      return phdude(root, ['analyze', 'run', id, '--allow-exec', '--json', ...ACTOR]);
    },
  },
  EXECUTION: {
    exit: 4,
    async run(root) {
      const id = await declareAnalysis(root, 'failing-script', 'process.exit(3);\n');
      return phdude(root, ['analyze', 'run', id, '--allow-exec', '--json', ...ACTOR]);
    },
  },
};

for (const [code, { exit, run }] of Object.entries(CASES)) {
  test(`${code} prints the frozen JSON error shape and exits ${exit}`, async (t) => {
    const root = await workspace(t);
    const result = await run(root);
    const error = parseError(result);
    assert.equal(error.code, code);
    assert.equal(result.code, exit);
    assert.equal(result.code, EXIT_CODES[code], `${code} is exit ${EXIT_CODES[code]}`);
  });
}

test('every error code the CLI can exit with is covered by a case', () => {
  const codes = Object.keys(EXIT_CODES).filter((code) => code !== 'OK');
  assert.deepEqual(codes.sort(), Object.keys(CASES).sort());
});

test('details is the array of located problems, one string each', async (t) => {
  const root = await workspace(t);
  await writeFile(
    join(root, 'findings.json'),
    JSON.stringify({ findings: [{ kind: 'not-a-field' }] }),
  );
  const result = await phdude(root, [
    'review',
    'submit',
    '--file',
    'findings.json',
    '--json',
    ...ACTOR,
  ]);
  const error = parseError(result);
  assert.equal(error.code, 'VALIDATION');
  assert.equal(result.code, 2);
  assert.ok(error.details.length > 0);
  for (const detail of error.details) assert.equal(typeof detail, 'string');
  assert.match(error.details[0], /findings\[0\]/, 'a detail locates the problem it reports');
});

test('without --json the same error prints details, then the message, then the hint', async (t) => {
  const root = await workspace(t);
  await writeFile(
    join(root, 'findings.json'),
    JSON.stringify({ findings: [{ kind: 'not-a-field' }] }),
  );
  const result = await phdude(root, ['review', 'submit', '--file', 'findings.json', ...ACTOR]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  const lines = result.stderr.trimEnd().split('\n');
  assert.match(lines[0], /^ {2}- findings\[0\]/);
  assert.match(lines.at(-1), /^Suggested action: /);
  assert.doesNotMatch(result.stderr, /^\{/, 'the human form is never JSON');
});

test('phdude --version prints the package version and exits 0', async (t) => {
  const root = await workspace(t);
  const { version } = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8'));
  for (const flag of ['--version', '-v']) {
    const result = await phdude(root, [flag]);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, `phdude ${version}\n`);
    assert.equal(result.stderr, '');
  }
});

test('docs/cli.md marks every command stable', async () => {
  const doc = await readFile(join(REPO_ROOT, 'docs', 'cli.md'), 'utf8');
  const lines = doc.split('\n');
  const marked = new Set();
  lines.forEach((line, index) => {
    const heading = /^### `phdude ([a-z][a-z-]*)/.exec(line);
    if (!heading) return;
    assert.equal(
      lines[index + 2],
      'Stability: stable',
      `docs/cli.md: "${line}" has no stability line under it`,
    );
    marked.add(heading[1]);
  });
  for (const command of Object.keys(COMMAND_OPTIONS)) {
    assert.ok(marked.has(command), `docs/cli.md does not mark ${command} stable`);
  }
});

test('a usage failure adds the usage block for humans and never to the JSON stream', async (t) => {
  const root = await workspace(t);
  const human = await phdude(root, ['bogus-command']);
  assert.equal(human.code, 1);
  assert.match(human.stderr, /unknown command "bogus-command"/);
  assert.match(human.stderr, /phdude <command>/);

  const json = await phdude(root, ['bogus-command', '--json']);
  assert.equal(json.stderr.trimEnd().split('\n').at(-1), '}');
});

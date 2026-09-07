import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..', '..');
const GENERATOR = join(REPO_ROOT, 'generators', 'bar-chart.mjs');
const FIXTURES = join(REPO_ROOT, 'tests', 'fixtures', 'analysis');
const GOLDEN = join(here, 'expected', 'bar-chart.svg');

// The generator is run the way `phdude figure build` runs it: the Node binary, an argument
// array, and the workspace as the working directory. Nothing here goes through a shell.
function generate(cwd, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [GENERATOR, ...args], { cwd }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-bar-chart-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'analysis', 'out'), { recursive: true });
  await mkdir(join(root, 'data'), { recursive: true });
  await cp(join(FIXTURES, 'results.json'), join(root, 'analysis', 'out', 'results.json'));
  await cp(join(FIXTURES, 'survey.csv'), join(root, 'data', 'survey.csv'));
  return root;
}

const ARGS = [
  '--input',
  'analysis/out/results.json',
  '--key',
  'mean_weight_by_group',
  '--out',
  'figures/out/mean-weight.svg',
  '--title',
  'Mean weight by group',
  '--alt',
  'Bar chart: group b averages 75.5 kg, group a 71.4 kg and group c 68.2 kg.',
];

test('bar-chart golden: the shipped generator writes exactly the committed SVG', async (t) => {
  const root = await workspace(t);
  const run = await generate(root, ARGS);
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, 'figures/out/mean-weight.svg\n');

  const svg = await readFile(join(root, 'figures', 'out', 'mean-weight.svg'), 'utf8');
  if (process.env.UPDATE_GOLDEN) {
    await writeFile(GOLDEN, svg);
    return;
  }
  assert.equal(svg, await readFile(GOLDEN, 'utf8'));
});

test('bar-chart golden: the SVG is accessible — a title, a desc holding the alt text, axis labels', async () => {
  if (process.env.UPDATE_GOLDEN) return;
  const svg = await readFile(GOLDEN, 'utf8');
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-labelledby="figure-title figure-desc"/);
  assert.match(svg, /<title id="figure-title">Mean weight by group<\/title>/);
  assert.match(svg, /<desc id="figure-desc">Bar chart: group b averages 75\.5 kg/);
  assert.match(svg, />mean_weight_by_group \(kg\)</, 'the y axis is not labelled');
  for (const label of ['a', 'b', 'c']) {
    assert.match(svg, new RegExp(`>${label}<`), `the ${label} bar is not labelled`);
  }
});

test('bar-chart golden: no external font, no external resource, no timestamp', async () => {
  if (process.env.UPDATE_GOLDEN) return;
  const svg = await readFile(GOLDEN, 'utf8');
  assert.doesNotMatch(svg, /@font-face|https?:\/\/(?!www\.w3\.org)/);
  assert.doesNotMatch(svg, /\d{4}-\d{2}-\d{2}T/);
});

test('the generator is deterministic: the same input twice is the same bytes', async (t) => {
  const root = await workspace(t);
  await generate(root, ARGS);
  const first = await readFile(join(root, 'figures', 'out', 'mean-weight.svg'), 'utf8');
  await generate(root, ARGS);
  const second = await readFile(join(root, 'figures', 'out', 'mean-weight.svg'), 'utf8');
  assert.equal(first, second);
});

test('the generator charts a dataset column as one bar per distinct value', async (t) => {
  const root = await workspace(t);
  const run = await generate(root, [
    '--input',
    'data/survey.csv',
    '--key',
    'group',
    '--out',
    'figures/out/groups.svg',
    '--title',
    'Respondents per group',
    '--alt',
    'Groups a and b hold two respondents each, group c one.',
  ]);
  assert.equal(run.code, 0, run.stderr);

  const svg = await readFile(join(root, 'figures', 'out', 'groups.svg'), 'utf8');
  assert.match(svg, />count</, 'a column chart counts rows, and says so on the y axis');
  assert.match(svg, />group</, 'the x axis names the column');
  assert.equal(svg.match(/fill="#0072b2"/g).length, 3, 'one bar per distinct value');
});

test('the generator refuses to invent a figure it was not given the data for', async (t) => {
  const root = await workspace(t);
  const cases = [
    [['--key', 'no_such_key'], /no result with key "no_such_key"/],
    [['--input', 'data/survey.csv', '--key', 'no_such_column'], /no column "no_such_column"/],
    [['--input', '../escape.json'], /inside the workspace/],
    [['--out', '/tmp/escape.svg'], /inside the workspace/],
    [['--input', 'data/survey.txt'], /unsupported input/],
  ];

  for (const [override, expected] of cases) {
    const run = await generate(root, [...ARGS, ...override]);
    assert.equal(run.code, 1, `${override.join(' ')} should have failed`);
    assert.match(run.stderr, expected);
  }
});

test('a required argument the generator was not given is named, not guessed at', async (t) => {
  const root = await workspace(t);
  for (const name of ['input', 'key', 'out', 'title', 'alt']) {
    const args = [...ARGS];
    args.splice(args.indexOf(`--${name}`), 2);
    const run = await generate(root, args);
    assert.equal(run.code, 1);
    assert.match(run.stderr, new RegExp(`--${name} is required`));
  }
});

test('the generator plots a percentage result, and a negative value against a zero baseline', async (t) => {
  const root = await workspace(t);
  const shares = await generate(root, [
    '--input',
    'analysis/out/results.json',
    '--key',
    'share_returning',
    '--out',
    'figures/out/shares.svg',
    '--title',
    'Panel retention',
    '--alt',
    'Just over half the panel returned.',
  ]);
  assert.equal(shares.code, 0, shares.stderr);
  const svg = await readFile(join(root, 'figures', 'out', 'shares.svg'), 'utf8');
  assert.match(svg, />0\.5231</);

  await writeFile(
    join(root, 'analysis', 'out', 'deltas.json'),
    JSON.stringify({ change: { up: 3, down: -2 } }),
  );
  const deltas = await generate(root, [
    '--input',
    'analysis/out/deltas.json',
    '--key',
    'change',
    '--out',
    'figures/out/deltas.svg',
    '--title',
    'Change',
    '--alt',
    'One group gained three, the other lost two.',
  ]);
  assert.equal(deltas.code, 0, deltas.stderr);
  const delta = await readFile(join(root, 'figures', 'out', 'deltas.svg'), 'utf8');
  assert.match(delta, />-2</, 'the negative value is labelled');
  assert.match(delta, />0</, 'the zero baseline is on the axis');
});

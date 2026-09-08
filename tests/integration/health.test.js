import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { renderHealth } from '../../src/adapters/cli/output.js';
import { compute } from '../../src/application/health.js';
import { addEntity } from '../../src/application/add.js';
import { CURRENT_WORKSPACE_VERSION } from '../../src/domain/versioning.js';

const actor = { researcher: 'test', agent: 'node' };
const NOW = () => '2026-09-07T12:00:00Z';

function makeDeps(root, clock = NOW) {
  return { store: new FsStore(root), clock, actor };
}

async function newRoot({ weights = null, workspaceVersion = CURRENT_WORKSPACE_VERSION } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-health-'));
  await mkdir(join(root, '.phdude'), { recursive: true });
  await writeFile(
    join(root, 'phdude.yaml'),
    [
      'schema: phdude.project',
      'version: 1',
      `workspace_version: ${workspaceVersion}`,
      'title: Health test',
      'language: en',
      'fields: []',
      'methods: []',
      'outputs: [thesis]',
      'mode: full',
      'agents: [claude-code]',
    ].join('\n') + '\n',
  );
  await writeFile(
    join(root, '.phdude', 'research-policy.yaml'),
    weights === null
      ? 'network:\n  enabled: false\n'
      : ['health:', '  weights:', ...weights.map((line) => `    ${line}`), ''].join('\n'),
  );
  return root;
}

// One question, one claim behind it, one evidence item and the source it cites: enough for
// every dimension that can score without an analysis or a manuscript.
async function seed(deps) {
  const question = await addEntity(deps, 'question', {
    text: 'Does open peer review change review quality?',
  });
  const source = await addEntity(deps, 'source', {
    title: 'Open review at scale',
    authors: ['Ada Lovelace'],
    year: 2024,
    type: 'article',
  });
  const evidence = await addEntity(deps, 'evidence', {
    source: source.obj.id,
    excerpt: 'Reviews were longer.',
    strength: 'strong',
  });
  const claim = await addEntity(deps, 'claim', {
    statement: 'Open review lengthens reviews.',
    kind: 'empirical',
    questions: [question.obj.id],
    supported_by: [evidence.obj.id],
  });
  return { question: question.obj, source: source.obj, evidence: evidence.obj, claim: claim.obj };
}

test('health: scores the workspace and explains every dimension it scored', async () => {
  const deps = makeDeps(await newRoot());
  await seed(deps);

  const report = await compute(deps);

  assert.equal(report.dimensions.length, 8);
  assert.equal(report.at, '2026-09-07T12:00:00Z');
  assert.equal(typeof report.overall, 'number');
  for (const dimension of report.dimensions) {
    assert.ok(dimension.observations.length > 0, `${dimension.key} explains nothing`);
  }

  const text = renderHealth(report);
  assert.match(text, /^Research Health: \d+\/100/);
  assert.match(text, /Academic Prose Quality\s+n\/a/);
});

test('health: reads without --save, and writes nothing at all', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await seed(deps);
  const before = (await deps.store.readEvents()).length;

  const report = await compute(deps);

  assert.equal(report.saved, null);
  assert.equal(report.trend, null);
  assert.equal(await deps.store.readYaml(join('reports', 'health.yaml')), null);
  assert.equal((await deps.store.readEvents()).length, before);
});

test('health --save: writes reports/health.yaml and exactly one health event', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await seed(deps);
  const before = (await deps.store.readEvents()).filter((e) => e.op === 'health').length;

  const report = await compute(deps, { save: true });

  assert.equal(report.saved, join(root, 'reports', 'health.yaml'));
  const stored = parse(await readFile(join(root, 'reports', 'health.yaml'), 'utf8'));
  assert.equal(stored.schema, 'phdude.health');
  assert.equal(stored.version, 1);
  assert.equal(stored.at, '2026-09-07T12:00:00Z');
  assert.equal(stored.overall, report.overall);
  assert.deepEqual(
    stored.dimensions.map((d) => d.key),
    report.dimensions.map((d) => d.key),
  );
  // The observations are recomputed on every run, so the saved file keeps only what --trend needs.
  assert.deepEqual(Object.keys(stored.dimensions[0]).sort(), ['key', 'score', 'weight']);

  const events = (await deps.store.readEvents()).filter((e) => e.op === 'health');
  assert.equal(events.length, before + 1);
  assert.equal(events.at(-1).ts, '2026-09-07T12:00:00Z');
  assert.match(events.at(-1).summary, /^health saved: overall \d+\/100$/);
  assert.deepEqual(events.at(-1).ids, []);
});

test('health --save: the second save replaces the first, latest only', async () => {
  const root = await newRoot();
  await seed(makeDeps(root));

  await compute(makeDeps(root), { save: true });
  await compute(
    makeDeps(root, () => '2026-09-09T12:00:00Z'),
    { save: true },
  );

  const stored = parse(await readFile(join(root, 'reports', 'health.yaml'), 'utf8'));
  assert.equal(stored.at, '2026-09-09T12:00:00Z');
  const events = (await new FsStore(root).readEvents()).filter((e) => e.op === 'health');
  assert.equal(events.length, 2);
});

test('health --trend: reports the deltas against the saved report', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  const seeded = await seed(deps);
  await compute(deps, { save: true });

  // A second question nobody has answered pulls Literature Coverage and Freshness down.
  await addEntity(deps, 'question', { text: 'Does open review deter reviewers?' });

  const report = await compute(
    makeDeps(root, () => '2026-09-09T12:00:00Z'),
    { trend: true },
  );

  assert.equal(report.trend.at, '2026-09-07T12:00:00Z');
  assert.ok(report.trend.overall.delta < 0, 'the overall should have fallen');
  const coverage = report.trend.dimensions.find((d) => d.key === 'literature-coverage');
  assert.equal(coverage.delta, coverage.score - coverage.previous);
  assert.ok(coverage.delta < 0);

  const text = renderHealth(report);
  assert.match(text, /Trend since 2026-09-07T12:00:00Z/);
  assert.ok(seeded.claim.id.startsWith('CLAIM-'));
});

test('health --trend: says so when nothing has been saved yet', async () => {
  const deps = makeDeps(await newRoot());
  await seed(deps);

  const report = await compute(deps, { trend: true });

  assert.deepEqual(report.trend, { at: null, overall: null, dimensions: [] });
  assert.match(renderHealth(report), /nothing saved yet/);
});

test('health: the citation findings are the ones cite check reports', async () => {
  const deps = makeDeps(await newRoot());
  await seed(deps);
  // A source with no year and no authors: two `missing-field` findings' worth of one finding,
  // plus the uncited-source finding that cite check calls informational.
  await addEntity(deps, 'source', { title: 'Untraceable', type: 'web' });

  const report = await compute(deps);
  const citation = report.dimensions.find((d) => d.key === 'citation-quality');

  assert.equal(citation.score, 90);
  assert.ok(citation.observations.some((o) => /is missing authors, year/.test(o.message)));
  assert.ok(citation.observations.some((o) => /costs nothing here/.test(o.message)));
});

test('health: the weights come from the research policy', async () => {
  const root = await newRoot({ weights: ['evidence-strength: 4', 'consistency: 0'] });
  const deps = makeDeps(root);
  await seed(deps);

  const report = await compute(deps);

  assert.equal(report.weights['evidence-strength'], 4);
  assert.equal(report.weights.consistency, 0);
  assert.equal(report.dimensions.find((d) => d.key === 'consistency').weight, 0);
});

test('health --save: refuses on a workspace that has not been migrated', async () => {
  const root = await newRoot({ workspaceVersion: 1 });
  const deps = makeDeps(root);

  await assert.rejects(compute(deps, { save: true }), (err) => {
    assert.equal(err.code, 'USAGE');
    assert.match(err.hint, /phdude migrate/);
    return true;
  });

  // Reading is always allowed: a researcher can still look at the score.
  const report = await compute(deps);
  assert.equal(report.saved, null);
});

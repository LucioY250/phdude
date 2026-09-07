import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { newArtifact } from '../../src/domain/entities.js';
import { addEntity } from '../../src/application/add.js';
import * as cite from '../../src/application/cite.js';
import { PhdudeError } from '../../src/domain/errors.js';

const actor = { researcher: 'test', agent: 'node' };

function makeDeps(root) {
  let tick = 0;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
    actor,
  };
}

async function newRoot() {
  const root = await mkdtemp(join(tmpdir(), 'phdude-cite-'));
  return root;
}

async function writeArtifact(deps, id) {
  const artifact = newArtifact({
    id,
    path: `sources/${id}.md`,
    hash: 'a'.repeat(64),
    bytes: 10,
    kind: 'md',
    mtime: '2026-01-01T00:00:00.000Z',
    actor,
    created: '2026-01-01T00:00:00.000Z',
  });
  await deps.store.writeEntity(artifact);
  return artifact;
}

test('list: reports bibkey, authors, year, doi and cited_by, sorted by bibkey', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: cited } = await addEntity(deps, 'source', {
    title: 'A Study of Cognitive Load',
    authors: ['Z. Zeta'],
    year: 2020,
    type: 'article',
    identifiers: { doi: '10.1234/z.2020.01' },
  });
  const { obj: uncited } = await addEntity(deps, 'source', {
    title: 'A Different Study of Behavior',
    authors: ['A. Alpha'],
    year: 2020,
    type: 'article',
  });
  await addEntity(deps, 'evidence', {
    source: cited.id,
    excerpt: 'Some finding.',
  });

  const rows = await cite.list(deps);
  assert.deepEqual(
    rows.map((r) => r.id),
    [uncited.id, cited.id],
    'sorted by bibkey (alpha... before zeta...)',
  );
  const zetaRow = rows.find((r) => r.id === cited.id);
  assert.equal(zetaRow.bibkey, 'zeta2020study');
  assert.deepEqual(zetaRow.authors, ['Z. Zeta']);
  assert.equal(zetaRow.year, 2020);
  assert.equal(zetaRow.doi, '10.1234/z.2020.01');
  assert.equal(zetaRow.cited_by, 1);

  const alphaRow = rows.find((r) => r.id === uncited.id);
  assert.equal(alphaRow.cited_by, 0);
  assert.equal(alphaRow.doi, null);
});

test('list: an evidence item citing an artifact directly does not count as citing a source', async () => {
  const deps = makeDeps(await newRoot());
  const art = await writeArtifact(deps, 'ART-abc1234567');
  const { obj: source } = await addEntity(deps, 'source', {
    title: 'A Study',
    authors: ['A. One'],
    year: 2020,
    artifacts: [art.id],
  });
  await addEntity(deps, 'evidence', { source: art.id, excerpt: 'Direct artifact citation.' });

  const rows = await cite.list(deps);
  assert.equal(rows.find((r) => r.id === source.id).cited_by, 0);
});

test('check: ok with no findings when every source is cited and complete', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: source } = await addEntity(deps, 'source', {
    title: 'A Complete Study',
    authors: ['A. One'],
    year: 2020,
    type: 'article',
  });
  await addEntity(deps, 'evidence', { source: source.id, excerpt: 'Finding.' });

  const report = await cite.check(deps);
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
});

test('check: uncited-source is informational and does not fail ok', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: source } = await addEntity(deps, 'source', {
    title: 'A Never Cited Study',
    authors: ['A. One'],
    year: 2020,
  });

  const report = await cite.check(deps);
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, [
    {
      kind: 'uncited-source',
      id: source.id,
      message: `${source.id} is not cited by any evidence`,
      hint: `phdude add evidence --json '{"source":"${source.id}",...}'`,
    },
  ]);
});

test('check: evidence-missing-source when the workspace was left with a dangling reference', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: source } = await addEntity(deps, 'source', {
    title: 'A Study',
    authors: ['A. One'],
    year: 2020,
  });
  const { obj: evidence } = await addEntity(deps, 'evidence', {
    source: source.id,
    excerpt: 'Finding.',
  });
  // Simulate the source disappearing from under the evidence (e.g. external edit); addEntity's
  // own reference check only runs at write time, so this is the only way to produce the case.
  await unlink(join(deps.store.root, 'knowledge', 'sources', `${source.id}.yaml`));

  const report = await cite.check(deps);
  assert.equal(report.ok, false);
  const finding = report.findings.find((f) => f.kind === 'evidence-missing-source');
  assert.ok(finding);
  assert.equal(finding.id, evidence.id);
  assert.match(finding.message, new RegExp(`cites ${source.id}, which does not exist`));
});

test('check: invalid-doi when the DOI does not match the pattern', async () => {
  const deps = makeDeps(await newRoot());
  // The legacy top-level `doi` field (kept for compatibility) carries no schema pattern, unlike
  // `identifiers.doi` - so an invalid one can actually reach the workspace for `check` to catch.
  const { obj: source } = await addEntity(deps, 'source', {
    title: 'A Study',
    authors: ['A. One'],
    year: 2020,
    doi: 'not-a-doi',
  });

  const report = await cite.check(deps);
  assert.equal(report.ok, false);
  const finding = report.findings.find((f) => f.kind === 'invalid-doi');
  assert.ok(finding);
  assert.equal(finding.id, source.id);
});

test('check: missing-field when authors is empty or year is absent', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: source } = await addEntity(deps, 'source', {
    title: 'A Study With No Authors Or Year',
  });

  const report = await cite.check(deps);
  assert.equal(report.ok, false);
  const finding = report.findings.find((f) => f.kind === 'missing-field' && f.id === source.id);
  assert.ok(finding);
  assert.match(finding.message, /authors/);
  assert.match(finding.message, /year/);
});

test('check: duplicate-source when two sources share normalized title+year', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: a } = await addEntity(deps, 'source', {
    title: 'A Shared Title',
    authors: ['A. One'],
    year: 2020,
  });
  // A source's id is derived from its normalized title+year (see domain/ids.js), so two
  // sources that genuinely share both always collapse into one record through `addEntity` -
  // that dedup is exactly why this finding exists as a defensive check instead: it catches
  // two records that reached the workspace some other way (e.g. a hand-edited YAML file, or a
  // migration importing legacy data) with distinct ids but the same title and year.
  const b = {
    schema: 'phdude.source',
    version: 1,
    id: 'SRC-bbbbbbbbbb',
    created: deps.clock(),
    actor,
    tags: [],
    title: 'A Shared Title',
    authors: ['B. Two'],
    type: 'article',
    artifacts: [],
    state: 'candidate',
    year: 2020,
  };
  await deps.store.writeEntity(b);
  assert.notEqual(a.id, b.id, 'test setup: two distinct source ids');

  const report = await cite.check(deps);
  assert.equal(report.ok, false);
  const findings = report.findings.filter((f) => f.kind === 'duplicate-source');
  assert.deepEqual(findings.map((f) => f.id).sort(), [a.id, b.id].sort());
});

test('check: duplicate-bibkey when two sources declare the same explicit bibkey', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: a } = await addEntity(deps, 'source', {
    title: 'First Study',
    authors: ['A. One'],
    year: 2020,
    bibkey: 'dup-key',
  });
  const { obj: b } = await addEntity(deps, 'source', {
    title: 'Second Study',
    authors: ['B. Two'],
    year: 2021,
    bibkey: 'dup-key',
  });

  const report = await cite.check(deps);
  assert.equal(report.ok, false);
  const findings = report.findings.filter((f) => f.kind === 'duplicate-bibkey');
  assert.deepEqual(findings.map((f) => f.id).sort(), [a.id, b.id].sort());
});

test('export: bibtex writes references.bib at the workspace root, no event recorded', async () => {
  const deps = makeDeps(await newRoot());
  await addEntity(deps, 'source', {
    title: 'A Study',
    authors: ['A. One'],
    year: 2020,
    type: 'article',
  });
  const before = (await deps.store.readEvents()).length;

  const result = await cite.exportRegistry({ store: deps.store, format: 'bibtex' });
  assert.equal(result.path, join(deps.store.root, 'references.bib'));
  assert.equal(result.count, 1);

  const text = await readFile(result.path, 'utf8');
  assert.match(text, /@article\{one2020study,/);

  const after = (await deps.store.readEvents()).length;
  assert.equal(after, before, 'export is derived, not knowledge - it records no event');
});

test('export: csl-json writes references.json', async () => {
  const deps = makeDeps(await newRoot());
  await addEntity(deps, 'source', { title: 'A Study', authors: ['A. One'], year: 2020 });

  const result = await cite.exportRegistry({ store: deps.store, format: 'csl-json' });
  assert.equal(result.path, join(deps.store.root, 'references.json'));

  const parsed = JSON.parse(await readFile(result.path, 'utf8'));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'one2020study');
});

test('export: defaults to bibtex when no format is given', async () => {
  const deps = makeDeps(await newRoot());
  await addEntity(deps, 'source', { title: 'A Study', authors: ['A. One'], year: 2020 });
  const result = await cite.exportRegistry({ store: deps.store });
  assert.equal(result.path, join(deps.store.root, 'references.bib'));
});

test('export: rejects an unknown format', async () => {
  const deps = makeDeps(await newRoot());
  await assert.rejects(
    () => cite.exportRegistry({ store: deps.store, format: 'ris' }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'USAGE');
      return true;
    },
  );
});

test('export: refuses on an out-of-date workspace', async () => {
  const deps = makeDeps(await newRoot());
  await addEntity(deps, 'source', { title: 'A Study', authors: ['A. One'], year: 2020 });
  await deps.store.writeProject({
    schema: 'phdude.project',
    version: 1,
    workspace_version: 1,
    title: 'Outdated',
    fields: [],
    methods: [],
    outputs: [],
    mode: 'full',
    agents: [],
  });

  await assert.rejects(
    () => cite.exportRegistry({ store: deps.store }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'USAGE');
      assert.match(err.message, /workspace needs migration/);
      return true;
    },
  );
});

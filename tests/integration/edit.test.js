import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { addEntity } from '../../src/application/add.js';
import { edit } from '../../src/application/edit.js';
import { newCandidate, newSearch } from '../../src/domain/entities.js';

const actor = { researcher: 'test', agent: 'node' };

function makeDeps(root) {
  let tick = 0;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 8, 7, 0, 0, tick++)).toISOString(),
    actor,
  };
}

async function newRoot() {
  return mkdtemp(join(tmpdir(), 'phdude-edit-'));
}

async function aSource(deps, overrides = {}) {
  const { obj } = await addEntity(deps, 'source', {
    title: 'A Study of Reproducible Pipelines',
    authors: ['A. One'],
    year: 2023,
    type: 'article',
    ...overrides,
  });
  return obj;
}

test('edit: changes a non-identity field, keeps the id, and writes one edit event', async () => {
  const deps = makeDeps(await newRoot());
  const source = await aSource(deps);

  const updated = await edit(deps, source.id, {
    venue: 'Journal of Reproducibility',
    tags: ['read'],
  });

  assert.equal(updated.id, source.id, 'a non-identity change never moves the id');
  assert.equal(updated.venue, 'Journal of Reproducibility');
  assert.deepEqual(updated.tags, ['read']);
  assert.equal(updated.title, source.title, 'nothing else changed');

  const onDisk = await deps.store.readEntity(source.id);
  assert.equal(onDisk.venue, 'Journal of Reproducibility');

  const events = (await deps.store.readEvents()).filter((e) => e.op === 'edit');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].ids, [source.id]);
  assert.equal(events[0].summary, `edited ${source.id}: tags, venue`);
});

test('edit: refuses every identity field of every type, naming them', async () => {
  const deps = makeDeps(await newRoot());
  const source = await aSource(deps);
  const { obj: question } = await addEntity(deps, 'question', { text: 'Does it replicate?' });
  const { obj: claim } = await addEntity(deps, 'claim', { statement: 'It replicates.' });
  const { obj: evidence } = await addEntity(deps, 'evidence', {
    source: source.id,
    excerpt: 'an excerpt',
  });
  const { obj: method } = await addEntity(deps, 'method', { name: 'Cross-sectional survey' });

  const cases = [
    [source.id, { title: 'x' }, /title/],
    [source.id, { year: 2024 }, /year/],
    [question.id, { text: 'x' }, /text/],
    [claim.id, { statement: 'x' }, /statement/],
    [evidence.id, { excerpt: 'x', locator: 'p. 2' }, /excerpt, locator/],
    [method.id, { name: 'x' }, /name/],
  ];

  for (const [id, fields, pattern] of cases) {
    await assert.rejects(
      () => edit(deps, id, fields),
      (err) => {
        assert.equal(err.code, 'VALIDATION');
        assert.match(err.message, /cannot edit the identity field/);
        assert.match(err.message, pattern);
        return true;
      },
      `${id} ${JSON.stringify(fields)} should be refused`,
    );
  }
});

test('edit: refuses a field the type does not have, and lists what it accepts', async () => {
  const deps = makeDeps(await newRoot());
  const source = await aSource(deps);

  await assert.rejects(
    () => edit(deps, source.id, { venu: 'typo', nonsense: 1 }),
    (err) => {
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /unknown field\(s\) for source: nonsense, venu/);
      assert.match(err.hint, /editable: authors, venue/);
      return true;
    },
  );
});

test('edit: state is not editable - promotion has its own command', async () => {
  const deps = makeDeps(await newRoot());
  const source = await aSource(deps);

  await assert.rejects(() => edit(deps, source.id, { state: 'canonical' }), {
    code: 'VALIDATION',
  });
  assert.equal((await deps.store.readEntity(source.id)).state, 'candidate');
});

test('edit: refuses a canonical object', async () => {
  const deps = makeDeps(await newRoot());
  const source = await aSource(deps);
  await deps.store.writeEntity({ ...source, state: 'canonical' });

  await assert.rejects(
    () => edit(deps, source.id, { venue: 'x' }),
    (err) => {
      assert.equal(err.code, 'POLICY');
      assert.match(err.message, /canonical/);
      return true;
    },
  );
});

test('edit: refuses a candidate, an unknown id and an empty field set', async () => {
  const deps = makeDeps(await newRoot());
  const search = newSearch({
    query: 'reproducible pipelines',
    last_run: '2026-09-07T00:00:00Z',
    actor,
    created: '2026-09-07T00:00:00Z',
  });
  await deps.store.writeEntity(search);
  const candidate = newCandidate({
    provider: 'openalex',
    external_id: 'W1',
    title: 'A Preprint',
    year: 2024,
    query: 'reproducible pipelines',
    search: search.id,
    actor,
    created: '2026-09-07T00:00:00Z',
  });
  await deps.store.writeEntity(candidate);

  await assert.rejects(
    () => edit(deps, candidate.id, { tags: ['x'] }),
    (err) => {
      assert.equal(err.code, 'USAGE');
      assert.match(err.hint, /research accept|research dismiss/);
      return true;
    },
  );
  await assert.rejects(() => edit(deps, search.id, { tags: ['x'] }), { code: 'USAGE' });
  await assert.rejects(() => edit(deps, 'SRC-0000000000', { venue: 'x' }), { code: 'USAGE' });
  await assert.rejects(() => edit(deps, 'not-an-id', { venue: 'x' }), { code: 'USAGE' });

  const source = await aSource(deps);
  await assert.rejects(() => edit(deps, source.id, {}), { code: 'USAGE' });
});

test('edit: a value of the wrong shape is a validation error, not a broken file', async () => {
  const deps = makeDeps(await newRoot());
  const source = await aSource(deps);

  await assert.rejects(() => edit(deps, source.id, { authors: 'A. One' }), { code: 'VALIDATION' });
  assert.deepEqual((await deps.store.readEntity(source.id)).authors, ['A. One']);
  assert.equal((await deps.store.readEvents()).filter((e) => e.op === 'edit').length, 0);
});

test('edit: an artifact takes only role and tags', async () => {
  const deps = makeDeps(await newRoot());
  const artifact = {
    schema: 'phdude.artifact',
    version: 1,
    id: 'ART-0000000001',
    created: '2026-09-07T00:00:00Z',
    actor,
    path: 'sources/a.md',
    paths: ['sources/a.md'],
    hash: 'a'.repeat(64),
    bytes: 10,
    mime: 'text/markdown',
    kind: 'md',
    role: 'unknown',
    extracted: {
      status: 'ok',
      method: 'text',
      text_chars: 10,
      sections: 0,
      tables: 0,
      warnings: [],
    },
    mtime: '2026-09-07T00:00:00Z',
  };
  await deps.store.writeEntity(artifact);

  assert.equal((await edit(deps, artifact.id, { role: 'paper' })).role, 'paper');
  await assert.rejects(() => edit(deps, artifact.id, { path: 'sources/b.md' }), {
    code: 'VALIDATION',
  });
});

test("edit: a result's `from` is editable, its `summary` is not", async () => {
  const deps = makeDeps(await newRoot());
  const { obj: result } = await addEntity(deps, 'result', {
    summary: 'Adoption rose 12% between waves.',
    from: 'analysis/wave-comparison.R',
    values: { delta: 0.12 },
  });

  const updated = await edit(deps, result.id, { from: 'analysis/wave-comparison-v2.R' });
  assert.equal(updated.id, result.id, `only \`summary\` is the result's identity`);
  assert.equal(updated.from, 'analysis/wave-comparison-v2.R');

  await assert.rejects(
    () => edit(deps, result.id, { summary: 'Adoption fell.' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /cannot edit the identity field\(s\) of a result: summary/);
      assert.match(err.hint, /a result is identified by summary/);
      return true;
    },
  );
});

test('edit: a reference that does not resolve is refused, the way add refuses it', async () => {
  const deps = makeDeps(await newRoot());
  const source = await aSource(deps);
  const { obj: question } = await addEntity(deps, 'question', {
    text: 'How do open science practices spread?',
  });
  const { obj: claim } = await addEntity(deps, 'claim', {
    statement: 'Reproducible pipelines shorten review cycles.',
    kind: 'empirical',
  });

  const unknown = (fields) => async () => edit(deps, claim.id, fields);
  for (const fields of [
    { supported_by: ['EVID-0123456789'] },
    { questions: [question.id, 'RQ-9'] },
  ]) {
    await assert.rejects(unknown(fields)(), (err) => {
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /^unknown reference /);
      assert.equal(err.hint, 'run phdude knowledge list');
      return true;
    });
  }

  // The write never happened: the refusal is the whole point, not a warning after the fact.
  assert.deepEqual((await deps.store.readEntity(claim.id)).supported_by, []);

  // A source's `artifacts` is checked the same way, and a reference that does resolve is fine.
  await assert.rejects(edit(deps, source.id, { artifacts: ['ART-0123456789'] }), {
    code: 'VALIDATION',
  });
  assert.deepEqual((await edit(deps, claim.id, { questions: [question.id] })).questions, [
    question.id,
  ]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { newArtifact } from '../../src/domain/entities.js';
import { addEntity } from '../../src/application/add.js';
import { list, show, trace } from '../../src/application/knowledge.js';
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
  return mkdtemp(join(tmpdir(), 'phdude-knowledge-'));
}

test('add source -> evidence -> claim, then list/show/trace', async () => {
  const deps = makeDeps(await newRoot());

  const { obj: source, created: sourceCreated } = await addEntity(deps, 'source', {
    title: 'A Study of AI Adoption',
    year: 2023,
  });
  assert.equal(sourceCreated, true);

  const { obj: evidence, created: evidenceCreated } = await addEntity(deps, 'evidence', {
    source: source.id,
    excerpt: 'a supporting excerpt about adoption',
    locator: 'p. 1',
  });
  assert.equal(evidenceCreated, true);

  const { obj: claim, created: claimCreated } = await addEntity(deps, 'claim', {
    statement: 'AI adoption is rising among SMEs',
    supported_by: [evidence.id],
  });
  assert.equal(claimCreated, true);

  const claims = await list(deps, { type: 'claim' });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].id, claim.id);

  const queried = await list(deps, { type: 'claim', query: 'rising among' });
  assert.equal(queried.length, 1);
  const missed = await list(deps, { type: 'claim', query: 'nonexistent phrase' });
  assert.equal(missed.length, 0);

  const shown = await show(deps, claim.id);
  assert.equal(shown.id, claim.id);

  const traced = await trace(deps, claim.id);
  assert.equal(traced.id, claim.id);
  assert.ok(
    traced.up.some((o) => o.id === source.id),
    'trace up should include the source',
  );
  assert.ok(
    traced.up.some((o) => o.id === evidence.id),
    'trace up should include the evidence',
  );
});

test('adding evidence with an unknown source is rejected with VALIDATION', async () => {
  const deps = makeDeps(await newRoot());
  await assert.rejects(
    addEntity(deps, 'evidence', { source: 'SRC-0000000000', excerpt: 'x' }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      return true;
    },
  );
});

test('adding the same claim twice returns created:false and appends exactly one event', async () => {
  const deps = makeDeps(await newRoot());
  const input = { statement: 'Duplicate claim statement' };

  const first = await addEntity(deps, 'claim', input);
  assert.equal(first.created, true);

  const second = await addEntity(deps, 'claim', input);
  assert.equal(second.created, false);
  assert.equal(second.obj.id, first.obj.id);

  const events = await deps.store.readEvents();
  assert.equal(events.length, 1);
});

test('question numbering: RQ-1, then RQ-2', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: q1 } = await addEntity(deps, 'question', { text: 'What drives adoption?' });
  const { obj: q2 } = await addEntity(deps, 'question', { text: 'What blocks adoption?' });
  assert.equal(q1.id, 'RQ-1');
  assert.equal(q2.id, 'RQ-2');
});

test('question and hypothesis dedupe on normalized text', async () => {
  const deps = makeDeps(await newRoot());

  const { obj: q1, created: q1Created } = await addEntity(deps, 'question', {
    text: 'Does thing X increase Y?',
  });
  assert.equal(q1Created, true);
  assert.equal(q1.id, 'RQ-1');

  const { obj: q2, created: q2Created } = await addEntity(deps, 'question', {
    text: '  Does thing X   increase Y?  ',
  });
  assert.equal(q2Created, false, 're-adding the same question is a no-op');
  assert.equal(q2.id, 'RQ-1');

  const { obj: h1 } = await addEntity(deps, 'hypothesis', { text: 'X increases Y.' });
  const { obj: h2, created: h2Created } = await addEntity(deps, 'hypothesis', {
    text: 'x increases y.',
  });
  assert.equal(h2Created, false);
  assert.equal(h2.id, h1.id);

  assert.equal((await deps.store.listEntities('question')).length, 1);
  assert.equal((await deps.store.listEntities('hypothesis')).length, 1);

  const events = await deps.store.readEvents();
  assert.equal(events.length, 2, 'only the two creations are recorded');
});

test('artifact-role updates the role of an existing artifact and appends one event', async () => {
  const deps = makeDeps(await newRoot());
  const artifact = newArtifact({
    id: 'ART-abc1234567',
    path: 'sources/x.pdf',
    hash: 'a'.repeat(64),
    bytes: 10,
    kind: 'pdf',
    mtime: deps.clock(),
    actor,
    created: deps.clock(),
  });
  await deps.store.writeEntity(artifact);

  const { obj, created } = await addEntity(deps, 'artifact-role', {
    id: artifact.id,
    role: 'paper',
  });
  assert.equal(created, false);
  assert.equal(obj.role, 'paper');
  assert.equal((await deps.store.readEntity(artifact.id)).role, 'paper');

  const events = await deps.store.readEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].summary, 'artifact role set to paper');
  assert.deepEqual(events[0].ids, [artifact.id]);
});

test('artifact-role rejects an invalid role', async () => {
  const deps = makeDeps(await newRoot());
  const artifact = newArtifact({
    id: 'ART-abc1234568',
    path: 'sources/y.pdf',
    hash: 'b'.repeat(64),
    bytes: 10,
    kind: 'pdf',
    mtime: deps.clock(),
    actor,
    created: deps.clock(),
  });
  await deps.store.writeEntity(artifact);
  await assert.rejects(addEntity(deps, 'artifact-role', { id: artifact.id, role: 'not-a-role' }));
});

test('artifact-role rejects an unknown artifact id', async () => {
  const deps = makeDeps(await newRoot());
  await assert.rejects(
    addEntity(deps, 'artifact-role', { id: 'ART-0000000000', role: 'paper' }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      return true;
    },
  );
});

test('addEntity: an unknown top-level key is a validation error naming the field', async () => {
  const deps = makeDeps(await newRoot());
  await assert.rejects(
    addEntity(deps, 'claim', { statement: 'A typo-linked claim.', question: ['RQ-1'] }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      assert.equal(err.message, 'unknown field(s) for claim: question');
      assert.match(err.hint, /questions/);
      return true;
    },
  );
  assert.equal((await deps.store.listEntities('claim')).length, 0, 'nothing was written');
});

test('addEntity: several unknown keys are reported sorted, in one error', async () => {
  const deps = makeDeps(await newRoot());
  await assert.rejects(
    addEntity(deps, 'fact', {
      key: 'sample_size',
      value: 1,
      from: { artifact: 'ART-0000000000' },
      zeta: 1,
      alpha: 2,
    }),
    (err) => {
      assert.equal(err.message, 'unknown field(s) for fact: alpha, zeta');
      return true;
    },
  );
});

test('addEntity: artifact-role rejects unknown keys too', async () => {
  const deps = makeDeps(await newRoot());
  await assert.rejects(
    addEntity(deps, 'artifact-role', { id: 'ART-0000000000', roles: 'paper' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /unknown field\(s\) for artifact-role: roles/);
      return true;
    },
  );
});

test('addEntity: unknown type is rejected with USAGE', async () => {
  const deps = makeDeps(await newRoot());
  await assert.rejects(addEntity(deps, 'bogus', {}), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'USAGE');
    return true;
  });
});

test('show: unknown id rejects with USAGE', async () => {
  const deps = makeDeps(await newRoot());
  await assert.rejects(show(deps, 'CLAIM-0000000000'), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'USAGE');
    return true;
  });
});

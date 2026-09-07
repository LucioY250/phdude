import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { newArtifact } from '../../src/domain/entities.js';
import { addEntity } from '../../src/application/add.js';
import { link } from '../../src/application/link.js';
import { promote, propose, approve } from '../../src/application/decide.js';
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

async function fixture() {
  const deps = makeDeps(await mkdtemp(join(tmpdir(), 'phdude-link-')));
  const artifact = newArtifact({
    id: 'ART-abc1234567',
    path: 'sources/x.md',
    hash: 'a'.repeat(64),
    bytes: 10,
    kind: 'md',
    mtime: '2026-01-01T00:00:00.000Z',
    actor,
    created: '2026-01-01T00:00:00.000Z',
  });
  await deps.store.writeEntity(artifact);

  const { obj: source } = await addEntity(deps, 'source', { title: 'A study of things' });
  const { obj: evidence } = await addEntity(deps, 'evidence', {
    source: source.id,
    locator: 'p. 4',
    excerpt: 'The intervention increased throughput.',
  });
  const { obj: question } = await addEntity(deps, 'question', { text: 'Does it scale?' });
  const { obj: claim } = await addEntity(deps, 'claim', {
    statement: 'The intervention increases throughput.',
  });
  const { obj: hypothesis } = await addEntity(deps, 'hypothesis', { text: 'It scales.' });

  return { deps, artifact, source, evidence, question, claim, hypothesis };
}

async function eventCount(deps) {
  return (await deps.store.readEvents()).length;
}

test('link: claim to evidence appends to supported_by and records one event', async () => {
  const { deps, claim, evidence } = await fixture();
  const before = await eventCount(deps);

  const result = await link(deps, claim.id, { to: [evidence.id] });

  assert.deepEqual(result.added, [evidence.id]);
  assert.deepEqual(result.obj.supported_by, [evidence.id]);
  assert.deepEqual((await deps.store.readEntity(claim.id)).supported_by, [evidence.id]);

  const events = await deps.store.readEvents();
  assert.equal(events.length, before + 1);
  assert.equal(events.at(-1).op, 'link');
  assert.deepEqual(events.at(-1).ids, [claim.id, evidence.id]);
  assert.equal(events.at(-1).summary, `${claim.id} linked to 1 object(s)`);
});

test('link: claim to a question appends to questions', async () => {
  const { deps, claim, question } = await fixture();
  const result = await link(deps, claim.id, { to: [question.id] });
  assert.deepEqual(result.obj.questions, [question.id]);
  assert.deepEqual(result.obj.supported_by, []);
});

test('link: one call may target several fields at once', async () => {
  const { deps, claim, evidence, question } = await fixture();
  const result = await link(deps, claim.id, { to: [evidence.id, question.id] });
  assert.deepEqual(result.added, [evidence.id, question.id]);
  assert.deepEqual(result.obj.supported_by, [evidence.id]);
  assert.deepEqual(result.obj.questions, [question.id]);

  const events = await deps.store.readEvents();
  assert.deepEqual(events.at(-1).ids, [claim.id, evidence.id, question.id]);
  assert.equal(events.at(-1).summary, `${claim.id} linked to 2 object(s)`);
});

test('link: hypothesis to question, source to artifact', async () => {
  const { deps, hypothesis, question, source, artifact } = await fixture();

  const h = await link(deps, hypothesis.id, { to: [question.id] });
  assert.deepEqual(h.obj.questions, [question.id]);

  const s = await link(deps, source.id, { to: [artifact.id] });
  assert.deepEqual(s.obj.artifacts, [artifact.id]);
});

test('link: an already-linked target is a no-op that writes nothing', async () => {
  const { deps, claim, evidence } = await fixture();
  await link(deps, claim.id, { to: [evidence.id] });
  const after = await eventCount(deps);

  const result = await link(deps, claim.id, { to: [evidence.id] });
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.obj.supported_by, [evidence.id]);
  assert.equal(await eventCount(deps), after, 'a no-op records no event');
});

test('link: an unknown target id is a validation error', async () => {
  const { deps, claim } = await fixture();
  await assert.rejects(link(deps, claim.id, { to: ['EVID-0000000000'] }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /unknown reference/);
    return true;
  });
});

test('link: a target of the wrong type is a validation error', async () => {
  const { deps, claim, source } = await fixture();
  await assert.rejects(link(deps, claim.id, { to: [source.id] }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /cannot link/);
    return true;
  });
});

test('link: nothing is written when one target of several fails', async () => {
  const { deps, claim, evidence } = await fixture();
  await assert.rejects(link(deps, claim.id, { to: [evidence.id, 'EVID-0000000000'] }));
  assert.deepEqual((await deps.store.readEntity(claim.id)).supported_by, []);
});

test('link: an object with no linkable relation is a validation error', async () => {
  const { deps, artifact, evidence } = await fixture();
  await assert.rejects(link(deps, artifact.id, { to: [evidence.id] }), (err) => {
    assert.equal(err.code, 'VALIDATION');
    return true;
  });
});

test('link: a canonical object is a policy error pointing at a decision', async () => {
  const { deps, claim, evidence } = await fixture();
  const { obj: decision } = await propose(deps, {
    title: 'Promote the throughput claim',
    rationale: 'Reviewed by the researcher.',
    affects: [claim.id],
  });
  await approve(deps, decision.id, { by: 'tester' });
  await promote(deps, claim.id, { decision: decision.id });

  await assert.rejects(link(deps, claim.id, { to: [evidence.id] }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'POLICY');
    assert.equal(err.hint, 'canonical objects change only through a decision; propose one');
    return true;
  });
});

test('link: an unknown object id is a usage error', async () => {
  const { deps, evidence } = await fixture();
  await assert.rejects(link(deps, 'CLAIM-0000000000', { to: [evidence.id] }), (err) => {
    assert.equal(err.code, 'USAGE');
    return true;
  });
});

test('link: no targets is a usage error', async () => {
  const { deps, claim } = await fixture();
  await assert.rejects(link(deps, claim.id, { to: [] }), (err) => {
    assert.equal(err.code, 'USAGE');
    return true;
  });
});

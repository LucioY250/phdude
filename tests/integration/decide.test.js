import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { newArtifact } from '../../src/domain/entities.js';
import { addEntity } from '../../src/application/add.js';
import { propose, approve, reject, supersede, promote } from '../../src/application/decide.js';
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
  return mkdtemp(join(tmpdir(), 'phdude-decide-'));
}

test('happy path: add claim -> propose -> approve -> promote canonical', async () => {
  const deps = makeDeps(await newRoot());

  const { obj: claim } = await addEntity(deps, 'claim', {
    statement: 'AI adoption is rising among SMEs',
  });
  assert.equal(claim.state, 'candidate');

  const { obj: decision, created: proposeCreated } = await propose(deps, {
    title: 'Confirm rising AI adoption claim',
    rationale: 'Cross-checked against two independent surveys.',
    affects: [claim.id],
  });
  assert.equal(proposeCreated, true);
  assert.equal(decision.status, 'proposed');
  assert.deepEqual(decision.approved_by, []);

  const approved = await approve(deps, decision.id, { by: 'lucio.yen@yavendio.com' });
  assert.equal(approved.status, 'approved');
  assert.deepEqual(approved.approved_by, ['lucio.yen@yavendio.com']);
  assert.ok(approved.resolved);

  const promoted = await promote(deps, claim.id, { to: 'canonical', decision: decision.id });
  assert.equal(promoted.state, 'canonical');

  const onDisk = await deps.store.readEntity(claim.id);
  assert.equal(onDisk.state, 'canonical');

  const events = await deps.store.readEvents();
  assert.deepEqual(
    events.map((e) => e.op),
    ['add', 'decide', 'decide', 'promote'],
  );
});

test('propose: unknown reference in affects is rejected with VALIDATION', async () => {
  const deps = makeDeps(await newRoot());
  await assert.rejects(
    propose(deps, { title: 'x', rationale: 'y', affects: ['CLAIM-0000000000'] }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      return true;
    },
  );
});

test('propose: same title twice returns existing decision with no new write/event', async () => {
  const deps = makeDeps(await newRoot());
  const input = { title: 'Duplicate decision', rationale: 'r' };

  const first = await propose(deps, input);
  assert.equal(first.created, true);

  const second = await propose(deps, input);
  assert.equal(second.created, false);
  assert.equal(second.obj.id, first.obj.id);

  const events = await deps.store.readEvents();
  assert.equal(events.length, 1);
});

test('approve: requires "by"', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: decision } = await propose(deps, { title: 'Needs approver', rationale: 'r' });
  await assert.rejects(approve(deps, decision.id, {}), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'USAGE');
    return true;
  });
});

test('addEntity: "decision" is rejected with USAGE pointing at decide propose', async () => {
  const deps = makeDeps(await newRoot());
  await assert.rejects(addEntity(deps, 'decision', { title: 'x', rationale: 'y' }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'USAGE');
    assert.ok(err.hint.includes('phdude decide propose'));
    return true;
  });
});

test('approve: idempotent for the same approver, one event only', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: decision } = await propose(deps, { title: 'Idempotent approval', rationale: 'r' });

  await approve(deps, decision.id, { by: 'a' });
  await approve(deps, decision.id, { by: 'a' });

  const events = await deps.store.readEvents();
  const approvalEvents = events.filter((e) => e.summary.includes('approved by a'));
  assert.equal(approvalEvents.length, 1);

  const onDisk = await deps.store.readEntity(decision.id);
  assert.deepEqual(onDisk.approved_by, ['a']);
});

test('approve: two different approvers both land in approved_by, one event each', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: decision } = await propose(deps, {
    title: 'Multi-approver decision',
    rationale: 'r',
  });

  await approve(deps, decision.id, { by: 'alice' });
  await approve(deps, decision.id, { by: 'bob' });

  const onDisk = await deps.store.readEntity(decision.id);
  assert.deepEqual(onDisk.approved_by, ['alice', 'bob']);
  assert.equal(onDisk.status, 'approved');

  const events = await deps.store.readEvents();
  const aliceEvents = events.filter((e) => e.summary === 'decision approved by alice');
  const bobEvents = events.filter((e) => e.summary === 'decision approved by bob');
  assert.equal(aliceEvents.length, 1);
  assert.equal(bobEvents.length, 1);
});

test('approve: rejected decisions cannot be approved', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: decision } = await propose(deps, { title: 'Will be rejected', rationale: 'r' });
  await reject(deps, decision.id, { by: 'a', reason: 'wrong' });

  await assert.rejects(approve(deps, decision.id, { by: 'b' }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'POLICY');
    return true;
  });
});

test('approve: superseded decisions cannot be approved', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: original } = await propose(deps, { title: 'Original decision', rationale: 'r' });
  const { obj: replacement } = await propose(deps, {
    title: 'Replacement decision',
    rationale: 'r2',
  });
  await supersede(deps, original.id, { by: replacement.id });

  await assert.rejects(approve(deps, original.id, { by: 'b' }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'POLICY');
    return true;
  });
});

test('reject: cannot reject an approved decision', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: decision } = await propose(deps, { title: 'Will be approved', rationale: 'r' });
  await approve(deps, decision.id, { by: 'a' });

  await assert.rejects(reject(deps, decision.id, { by: 'b', reason: 'changed my mind' }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'POLICY');
    return true;
  });
});

test('reject: requires "by"', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: decision } = await propose(deps, { title: 'Needs a rejector', rationale: 'r' });
  await assert.rejects(reject(deps, decision.id, { reason: 'no reason given' }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'USAGE');
    return true;
  });
});

test('reject: stores the rejection reason under change.rejection_reason', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: decision } = await propose(deps, { title: 'Reject me', rationale: 'r' });
  const rejected = await reject(deps, decision.id, { by: 'a', reason: 'insufficient evidence' });

  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.change.rejection_reason, 'insufficient evidence');
  assert.ok(rejected.resolved);
});

test('supersede: marks the old decision superseded and links the new one', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: original } = await propose(deps, { title: 'Original path', rationale: 'r' });
  await approve(deps, original.id, { by: 'a' });

  const { obj: replacement } = await propose(deps, {
    title: 'Replacement path',
    rationale: 'r2',
  });

  const superseded = await supersede(deps, original.id, { by: replacement.id });
  assert.equal(superseded.status, 'superseded');
  assert.equal(superseded.change.superseded_by, replacement.id);
});

test('supersede: a decision cannot supersede itself', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: decision } = await propose(deps, {
    title: 'Self-superseding decision',
    rationale: 'r',
  });

  await assert.rejects(supersede(deps, decision.id, { by: decision.id }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'USAGE');
    return true;
  });
});

test('promote: to "supported" needs no decision', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: claim } = await addEntity(deps, 'claim', { statement: 'A claim needing support' });
  const promoted = await promote(deps, claim.id, { to: 'supported' });
  assert.equal(promoted.state, 'supported');
});

test('promote: same-state promotion is a no-op (no write, no event)', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: claim } = await addEntity(deps, 'claim', { statement: 'Already candidate' });

  const promoted = await promote(deps, claim.id, { to: 'candidate' });
  assert.equal(promoted.state, 'candidate');

  const events = await deps.store.readEvents();
  assert.equal(events.length, 1);
});

test('promote: canonical without a decision is rejected with POLICY', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: claim } = await addEntity(deps, 'claim', { statement: 'No decision yet' });

  await assert.rejects(promote(deps, claim.id, { to: 'canonical' }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'POLICY');
    return true;
  });
});

test('promote: canonical with a proposed-but-unapproved decision is rejected with POLICY', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: claim } = await addEntity(deps, 'claim', { statement: 'Awaiting approval' });
  const { obj: decision } = await propose(deps, {
    title: 'Not yet approved',
    rationale: 'r',
    affects: [claim.id],
  });

  await assert.rejects(
    promote(deps, claim.id, { to: 'canonical', decision: decision.id }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'POLICY');
      return true;
    },
  );
});

test('promote: canonical with an approved decision that does not affect the claim is rejected with POLICY', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: claim } = await addEntity(deps, 'claim', { statement: 'Unrelated claim' });
  const { obj: decision } = await propose(deps, { title: 'Unrelated decision', rationale: 'r' });
  await approve(deps, decision.id, { by: 'a' });

  await assert.rejects(
    promote(deps, claim.id, { to: 'canonical', decision: decision.id }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'POLICY');
      return true;
    },
  );
});

test('promote: rejected -> canonical is blocked by canTransition (POLICY)', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: claim } = await addEntity(deps, 'claim', { statement: 'A rejected claim' });
  await promote(deps, claim.id, { to: 'rejected' });

  await assert.rejects(promote(deps, claim.id, { to: 'canonical' }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'POLICY');
    return true;
  });
});

test('promote: an id without a state field (artifact) is rejected with USAGE', async () => {
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

  await assert.rejects(promote(deps, artifact.id, { to: 'canonical' }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'USAGE');
    return true;
  });
});

test('promote: unknown target state is rejected with USAGE', async () => {
  const deps = makeDeps(await newRoot());
  const { obj: claim } = await addEntity(deps, 'claim', { statement: 'Whatever' });

  await assert.rejects(promote(deps, claim.id, { to: 'nonsense' }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'USAGE');
    return true;
  });
});

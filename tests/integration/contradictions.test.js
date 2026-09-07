import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { addEntity } from '../../src/application/add.js';
import { link } from '../../src/application/link.js';
import { promote, propose, approve } from '../../src/application/decide.js';
import { buildGraph, trace } from '../../src/domain/lineage.js';
import { status } from '../../src/application/status.js';
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
  const deps = makeDeps(await mkdtemp(join(tmpdir(), 'phdude-contradictions-')));
  const { obj: claimA } = await addEntity(deps, 'claim', { statement: 'The effect is positive.' });
  const { obj: claimB } = await addEntity(deps, 'claim', { statement: 'The effect is negative.' });
  return { deps, claimA, claimB };
}

async function eventCount(deps) {
  return (await deps.store.readEvents()).length;
}

test('link --contradicts: marks both claims disputed and records one event', async () => {
  const { deps, claimA, claimB } = await fixture();
  const before = await eventCount(deps);

  const result = await link(deps, claimA.id, { contradicts: claimB.id });

  assert.equal(result.linked, true);
  assert.equal(result.a.state, 'disputed');
  assert.equal(result.b.state, 'disputed');
  assert.deepEqual(result.a.contradicts, [claimB.id]);
  assert.deepEqual(result.b.contradicts, [claimA.id]);

  const onDiskA = await deps.store.readEntity(claimA.id);
  const onDiskB = await deps.store.readEntity(claimB.id);
  assert.equal(onDiskA.state, 'disputed');
  assert.equal(onDiskB.state, 'disputed');

  const events = await deps.store.readEvents();
  assert.equal(events.length, before + 1);
  assert.equal(events.at(-1).op, 'link');
  assert.deepEqual(events.at(-1).ids, [claimA.id, claimB.id]);
  assert.equal(events.at(-1).summary, `${claimA.id} contradicts ${claimB.id}`);
});

test('link --contradicts: idempotent - already recorded means no write, no event', async () => {
  const { deps, claimA, claimB } = await fixture();
  await link(deps, claimA.id, { contradicts: claimB.id });
  const after = await eventCount(deps);

  const result = await link(deps, claimA.id, { contradicts: claimB.id });
  assert.deepEqual(result, { linked: false });
  assert.equal(await eventCount(deps), after, 'a no-op records no event');
});

test('link --contradicts: heals an asymmetric pair left by a partial write', async () => {
  const { deps, claimA, claimB } = await fixture();

  // Simulate the first attempt dying after writing A but before writing B.
  await deps.store.writeEntity({ ...claimA, contradicts: [claimB.id], state: 'disputed' });
  assert.ok(!(await deps.store.readEntity(claimB.id)).contradicts?.includes(claimA.id));

  const before = await eventCount(deps);
  const result = await link(deps, claimA.id, { contradicts: claimB.id });

  assert.equal(result.linked, true);
  const onDiskA = await deps.store.readEntity(claimA.id);
  const onDiskB = await deps.store.readEntity(claimB.id);
  assert.deepEqual(onDiskA.contradicts, [claimB.id]);
  assert.equal(onDiskA.state, 'disputed');
  assert.deepEqual(onDiskB.contradicts, [claimA.id]);
  assert.equal(onDiskB.state, 'disputed');

  const events = await deps.store.readEvents();
  assert.equal(events.length, before + 1, 'the heal is a single event, not zero and not two');
});

test('link --contradicts: a claim cannot contradict itself', async () => {
  const { deps, claimA } = await fixture();
  await assert.rejects(link(deps, claimA.id, { contradicts: claimA.id }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'USAGE');
    assert.match(err.message, /cannot contradict itself/);
    return true;
  });
});

test('link --contradicts: --to and --contradicts are mutually exclusive', async () => {
  const { deps, claimA, claimB } = await fixture();
  const { obj: evidence } = await addEntity(deps, 'evidence', {
    source: (await addEntity(deps, 'source', { title: 'A study' })).obj.id,
    locator: 'p. 1',
    excerpt: 'x',
  });

  await assert.rejects(
    link(deps, claimA.id, { to: [evidence.id], contradicts: claimB.id }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'USAGE');
      assert.match(err.message, /mutually exclusive/);
      return true;
    },
  );
});

test('link --contradicts: an unknown target is a validation error', async () => {
  const { deps, claimA } = await fixture();
  await assert.rejects(link(deps, claimA.id, { contradicts: 'CLAIM-0000000000' }), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /unknown reference/);
    return true;
  });
});

test('link --contradicts: the target must be a claim', async () => {
  const { deps, claimA } = await fixture();
  const { obj: source } = await addEntity(deps, 'source', { title: 'A study' });
  await assert.rejects(link(deps, claimA.id, { contradicts: source.id }), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /not a claim/);
    return true;
  });
});

test('link --contradicts: a canonical claim may still be marked disputed (no decision needed)', async () => {
  const { deps, claimA, claimB } = await fixture();
  const { obj: decision } = await propose(deps, {
    title: 'Promote claim A',
    rationale: 'Reviewed.',
    affects: [claimA.id],
  });
  await approve(deps, decision.id, { by: 'tester' });
  await promote(deps, claimA.id, { decision: decision.id });
  assert.equal((await deps.store.readEntity(claimA.id)).state, 'canonical');

  const result = await link(deps, claimA.id, { contradicts: claimB.id });
  assert.equal(result.a.state, 'disputed');
  assert.equal(result.b.state, 'disputed');
});

test('lineage: contradicts edge appears once per pair, undirected in trace', async () => {
  const { deps, claimA, claimB } = await fixture();
  await link(deps, claimA.id, { contradicts: claimB.id });

  const a = await deps.store.readEntity(claimA.id);
  const b = await deps.store.readEntity(claimB.id);
  const graph = buildGraph([a, b]);

  const contradictsEdges = graph.edges.filter((e) => e.rel === 'contradicts');
  assert.equal(contradictsEdges.length, 1, 'exactly one edge per pair');

  const { down: downA } = trace(graph, claimA.id);
  const { down: downB } = trace(graph, claimB.id);
  assert.ok(downA.includes(claimB.id), 'B is related to A via down');
  assert.ok(downB.includes(claimA.id), 'A is related to B via down');

  const { up: upA } = trace(graph, claimA.id);
  const { up: upB } = trace(graph, claimB.id);
  assert.ok(!upA.includes(claimB.id), 'contradicts is not a dependency of A');
  assert.ok(!upB.includes(claimA.id), 'contradicts is not a dependency of B');
});

test('status: reports disputed pairs', async () => {
  const { deps, claimA, claimB } = await fixture();
  await link(deps, claimA.id, { contradicts: claimB.id });

  const report = await status({ store: deps.store });
  const expectedPair = [claimA.id, claimB.id].sort();
  assert.deepEqual(report.disputedPairs, [expectedPair]);
});

test('promote: moving a disputed claim to supported requires a resolving decision', async () => {
  const { deps, claimA, claimB } = await fixture();
  await link(deps, claimA.id, { contradicts: claimB.id });

  await assert.rejects(promote(deps, claimA.id, { to: 'supported' }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'POLICY');
    assert.match(err.hint, /resolves_contradiction/);
    return true;
  });
});

async function resolvingDecision(deps, { survivor, loser, resolves = [survivor, loser] } = {}) {
  const { obj: decision } = await propose(deps, {
    title: 'Resolve the effect-direction contradiction',
    rationale: 'The negative-effect claim used a flawed measure.',
    affects: [survivor, loser].filter(Boolean),
    change: { resolves_contradiction: resolves, survivor },
  });
  await approve(deps, decision.id, { by: 'tester' });
  return decision;
}

test('promote: blocked while the loser is still disputed, even with a valid resolving decision', async () => {
  const { deps, claimA, claimB } = await fixture();
  await link(deps, claimA.id, { contradicts: claimB.id });
  const decision = await resolvingDecision(deps, { survivor: claimA.id, loser: claimB.id });

  await assert.rejects(
    promote(deps, claimA.id, { to: 'supported', decision: decision.id }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'POLICY');
      assert.match(err.message, new RegExp(claimB.id));
      assert.match(err.hint, /promote .* --to rejected first/);
      return true;
    },
  );
});

test('promote: a decision naming the wrong claim as survivor blocks promoting the loser', async () => {
  const { deps, claimA, claimB } = await fixture();
  await link(deps, claimA.id, { contradicts: claimB.id });
  const decision = await resolvingDecision(deps, { survivor: claimA.id, loser: claimB.id });

  await assert.rejects(
    promote(deps, claimB.id, { to: 'supported', decision: decision.id }),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'POLICY');
      assert.match(err.message, new RegExp(`names ${claimA.id} as the survivor`));
      return true;
    },
  );
});

test('promote: a decision without change.survivor resolves nothing', async () => {
  const { deps, claimA, claimB } = await fixture();
  await link(deps, claimA.id, { contradicts: claimB.id });

  const { obj: decision } = await propose(deps, {
    title: 'Missing survivor field',
    rationale: 'Forgot to name a survivor.',
    affects: [claimA.id, claimB.id],
    change: { resolves_contradiction: [claimA.id, claimB.id] },
  });
  await approve(deps, decision.id, { by: 'tester' });

  await assert.rejects(
    promote(deps, claimA.id, { to: 'supported', decision: decision.id }),
    (err) => {
      assert.equal(err.code, 'POLICY');
      assert.match(err.message, /does not resolve/);
      return true;
    },
  );
});

test('promote: happy path - reject the loser, then the survivor promotes to supported', async () => {
  const { deps, claimA, claimB } = await fixture();
  await link(deps, claimA.id, { contradicts: claimB.id });
  const decision = await resolvingDecision(deps, { survivor: claimA.id, loser: claimB.id });

  const rejectedLoser = await promote(deps, claimB.id, { to: 'rejected' });
  assert.equal(rejectedLoser.state, 'rejected');

  const promoted = await promote(deps, claimA.id, { to: 'supported', decision: decision.id });
  assert.equal(promoted.state, 'supported');

  // The survivor's contradicts entry is kept as history; the loser is untouched otherwise.
  const survivor = await deps.store.readEntity(claimA.id);
  assert.deepEqual(survivor.contradicts, [claimB.id]);
  const loser = await deps.store.readEntity(claimB.id);
  assert.equal(loser.state, 'rejected');
});

test('promote: happy path - the survivor may also resolve to canonical', async () => {
  const { deps, claimA, claimB } = await fixture();
  await link(deps, claimA.id, { contradicts: claimB.id });
  const decision = await resolvingDecision(deps, { survivor: claimA.id, loser: claimB.id });

  await promote(deps, claimB.id, { to: 'rejected' });
  const promoted = await promote(deps, claimA.id, { to: 'canonical', decision: decision.id });
  assert.equal(promoted.state, 'canonical');
});

test('promote: a decision that does not name the contradicting partner is rejected', async () => {
  const { deps, claimA, claimB } = await fixture();
  await link(deps, claimA.id, { contradicts: claimB.id });

  const { obj: decision } = await propose(deps, {
    title: 'Unrelated decision',
    rationale: 'Does not resolve the dispute.',
    affects: [claimA.id],
    change: { resolves_contradiction: [claimA.id], survivor: claimA.id },
  });
  await approve(deps, decision.id, { by: 'tester' });

  await assert.rejects(
    promote(deps, claimA.id, { to: 'supported', decision: decision.id }),
    (err) => {
      assert.equal(err.code, 'POLICY');
      return true;
    },
  );
});

test('promote: the resolving decision must also affect the promoted claim', async () => {
  const { deps, claimA, claimB } = await fixture();
  await link(deps, claimA.id, { contradicts: claimB.id });
  await promote(deps, claimB.id, { to: 'rejected' });

  const { obj: decision } = await propose(deps, {
    title: 'Resolution that forgot to list the survivor in affects',
    rationale: 'r',
    affects: [claimB.id],
    change: { resolves_contradiction: [claimA.id, claimB.id], survivor: claimA.id },
  });
  await approve(deps, decision.id, { by: 'tester' });

  await assert.rejects(
    promote(deps, claimA.id, { to: 'supported', decision: decision.id }),
    (err) => {
      assert.equal(err.code, 'POLICY');
      assert.match(err.message, /does not affect/);
      return true;
    },
  );
});

test('promote: disputed -> rejected needs no resolving decision', async () => {
  const { deps, claimA, claimB } = await fixture();
  await link(deps, claimA.id, { contradicts: claimB.id });

  const rejected = await promote(deps, claimA.id, { to: 'rejected' });
  assert.equal(rejected.state, 'rejected');
});

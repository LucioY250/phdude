import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { addEntity } from '../../src/application/add.js';
import { promote } from '../../src/application/decide.js';
import * as manuscript from '../../src/application/manuscript.js';
import * as review from '../../src/application/review.js';
import { CURRENT_WORKSPACE_VERSION } from '../../src/domain/versioning.js';

const actor = { researcher: 'test', agent: 'node' };

function makeDeps(root) {
  let tick = 0;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
    actor,
    readText: (path) => readFile(join(root, path), 'utf8').catch(() => null),
  };
}

// One source, one question, one supported claim, a method and a planned manuscript: enough for a
// review context to have something to say and for a finding to have an id to name.
async function workspace({ mode } = {}) {
  const deps = makeDeps(await mkdtemp(join(tmpdir(), 'phdude-review-')));

  const { obj: source } = await addEntity(deps, 'source', {
    title: 'Adoption of AI in Small Firms',
    authors: ['Z. Zeta'],
    year: 2020,
    type: 'article',
  });
  const { obj: question } = await addEntity(deps, 'question', {
    text: 'How fast do small firms adopt AI?',
    objectives: ['Measure the lag'],
  });
  const { obj: evidence } = await addEntity(deps, 'evidence', {
    source: source.id,
    locator: 'p. 3',
    excerpt: 'Adoption is slower among firms below fifty employees.',
    strength: 'moderate',
  });
  const { obj: claim } = await addEntity(deps, 'claim', {
    statement: 'Small firms adopt AI more slowly than large ones.',
    kind: 'empirical',
    supported_by: [evidence.id],
    questions: [question.id],
    sections: ['Introduction'],
  });
  const { obj: method } = await addEntity(deps, 'method', {
    name: 'cross-sectional survey',
    design: 'one wave, self-administered',
    paradigm: 'quantitative',
    questions: [question.id],
  });
  await promote(deps, claim.id, { to: 'supported' });
  await manuscript.init(deps, { title: 'A thesis', language: 'en' });

  if (mode !== undefined) {
    await deps.store.writeProject({
      schema: 'phdude.project',
      version: 1,
      workspace_version: CURRENT_WORKSPACE_VERSION,
      title: 'A thesis',
      fields: [],
      methods: [],
      outputs: [],
      mode,
      agents: [],
    });
  }

  return { deps, source, question, evidence, claim, method };
}

async function findingsFile(deps, name, payload) {
  await writeFile(join(deps.store.root, name), JSON.stringify(payload, null, 2));
  return name;
}

async function events(deps) {
  return (await deps.store.readEvents()).filter((event) => event.op === 'review');
}

function rejectsWith(promise, code, match) {
  return assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    if (match) assert.match(err.message, match);
    return true;
  });
}

test('review <kind> writes the context to cache, records no event, and prints the contract', async () => {
  const { deps, claim } = await workspace();

  const result = await review.context(deps, { kind: 'methodology' });

  assert.equal(result.target.id, 'project');
  const text = await readFile(
    join(deps.store.root, '.phdude', 'cache', 'review', 'methodology', 'context.md'),
    'utf8',
  );
  assert.equal(text, result.markdown);
  assert.match(text, /^# Review context: methodology/);
  assert.ok(text.includes(claim.id), 'the claims in scope are in the context');
  assert.ok(
    result.contract.some((line) => line.includes('phdude review submit --file')),
    'the contract names the command that records the answer',
  );
  assert.deepEqual(await events(deps), [], 'assembling a context records nothing');
});

test('review <kind> refuses an unknown kind and an unknown target', async () => {
  const { deps } = await workspace();
  await rejectsWith(review.context(deps, { kind: 'vibes' }), 'USAGE', /unknown review kind/);
  await rejectsWith(
    review.context(deps, { kind: 'reviewer2', target: 'CLAIM-9999999999' }),
    'USAGE',
    /unknown review target/,
  );
  await rejectsWith(
    review.context(deps, { kind: 'reviewer2', target: 'manuscript:appendix' }),
    'USAGE',
    /unknown review target/,
  );
});

test('review <kind> refuses a workspace that needs migration before it writes its cache', async () => {
  const { deps } = await workspace();
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

  await rejectsWith(review.context(deps, { kind: 'reviewer2' }), 'USAGE', /needs migration/);
  assert.equal(
    await readFile(
      join(deps.store.root, '.phdude', 'cache', 'review', 'reviewer2', 'context.md'),
      'utf8',
    ).catch(() => null),
    null,
  );
});

test('review submit records each finding as a REVIEW object and one event listing them', async () => {
  const { deps, claim, evidence } = await workspace();

  const file = await findingsFile(deps, 'findings.json', {
    findings: [
      {
        target: claim.id,
        severity: 'major',
        message: 'The claim generalizes past the sampled region.',
        evidence: [evidence.id],
        suggested_command: `phdude knowledge show ${claim.id}`,
      },
      { target: 'project', severity: 'note', message: 'No preregistration is recorded.' },
    ],
  });

  const result = await review.submit(deps, { file, kind: 'reviewer2' });

  assert.equal(result.created.length, 2);
  assert.equal(result.existing.length, 0);
  assert.equal(result.kind, 'reviewer2');

  const stored = await deps.store.listEntities('review');
  assert.equal(stored.length, 2);
  for (const item of stored) {
    assert.equal(item.schema, 'phdude.review');
    assert.equal(item.kind, 'reviewer2');
    assert.equal(item.status, 'open');
    assert.deepEqual(item.by, actor);
    assert.match(item.id, /^REVIEW-[0-9a-f]{10}$/);
  }

  const onDisk = await readFile(
    join(deps.store.root, 'reviews', `${result.created[0].id}.yaml`),
    'utf8',
  );
  assert.match(onDisk, /schema: phdude\.review/);

  const recorded = await events(deps);
  assert.equal(recorded.length, 1, 'one event for the whole submit');
  assert.deepEqual(recorded[0].ids.sort(), stored.map((item) => item.id).sort());
  assert.match(recorded[0].summary, /reviewer2 review: 2 finding\(s\) recorded/);
});

test('review submit records the workspace review mode on each finding', async () => {
  const { deps } = await workspace({ mode: 'ruthless' });
  const file = await findingsFile(deps, 'findings.json', {
    findings: [{ target: 'project', severity: 'minor', message: 'A finding under ruthless.' }],
  });

  const result = await review.submit(deps, { file, kind: 'custom' });
  assert.equal(result.mode, 'ruthless');
  assert.equal(result.created[0].mode, 'ruthless');
  assert.equal(result.created[0].severity, 'minor', 'the stored severity is what was written');
});

test('review submit defaults to the custom kind and takes one from the file', async () => {
  const { deps } = await workspace();

  const bare = await findingsFile(deps, 'bare.json', {
    findings: [{ target: 'project', severity: 'note', message: 'No kind anywhere.' }],
  });
  assert.equal((await review.submit(deps, { file: bare })).kind, 'custom');

  const carried = await findingsFile(deps, 'carried.json', {
    kind: 'methodology',
    findings: [{ target: 'project', severity: 'note', message: 'The file names its kind.' }],
  });
  assert.equal((await review.submit(deps, { file: carried })).kind, 'methodology');
});

test('re-submitting a finding records nothing again and never reopens a dismissed one', async () => {
  const { deps } = await workspace();
  const payload = {
    findings: [{ target: 'project', severity: 'major', message: 'The baseline is undescribed.' }],
  };
  const file = await findingsFile(deps, 'findings.json', payload);

  const first = await review.submit(deps, { file, kind: 'reviewer2' });
  const id = first.created[0].id;
  await review.dismiss(deps, id, { reason: 'the baseline is in the appendix' });

  const second = await review.submit(deps, { file, kind: 'reviewer2' });
  assert.deepEqual(second.created, []);
  assert.equal(second.existing.length, 1);
  assert.equal(second.existing[0].status, 'dismissed', 'the verdict survives a re-run');
  assert.equal(second.existing[0].reason, 'the baseline is in the appendix');

  assert.equal((await deps.store.listEntities('review')).length, 1);
  const recorded = await events(deps);
  assert.equal(recorded.length, 2, 'the submit that created nothing recorded no event');
  assert.match(recorded[1].summary, /dismissed/);
});

test('the same message under a different kind or target is a different finding', async () => {
  const { deps, claim } = await workspace();
  const message = 'This needs a second look.';

  const a = await findingsFile(deps, 'a.json', {
    findings: [{ target: 'project', severity: 'note', message }],
  });
  const b = await findingsFile(deps, 'b.json', {
    findings: [{ target: claim.id, severity: 'note', message }],
  });

  const first = await review.submit(deps, { file: a, kind: 'reviewer2' });
  const second = await review.submit(deps, { file: a, kind: 'methodology' });
  const third = await review.submit(deps, { file: b, kind: 'reviewer2' });

  const ids = new Set([first.created[0].id, second.created[0].id, third.created[0].id]);
  assert.equal(ids.size, 3);
});

test('review submit refuses a file naming an id or a section the workspace does not have', async () => {
  const { deps, claim } = await workspace();
  const file = await findingsFile(deps, 'findings.json', {
    findings: [
      { target: 'CLAIM-9999999999', severity: 'note', message: 'A target that is gone.' },
      {
        target: claim.id,
        severity: 'note',
        message: 'Evidence that is gone.',
        evidence: ['EVID-9999999999'],
      },
    ],
  });

  await assert.rejects(
    () => review.submit(deps, { file, kind: 'reviewer2' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION');
      assert.equal(err.details.length, 2);
      assert.match(err.details[0], /findings\[0\] unknown target/);
      assert.match(err.details[1], /findings\[1\] unknown evidence id/);
      return true;
    },
  );

  assert.deepEqual(await deps.store.listEntities('review'), [], 'nothing is written');
  assert.deepEqual(await events(deps), []);
});

test('review submit refuses a missing file and a file that is not JSON', async () => {
  const { deps } = await workspace();
  await rejectsWith(review.submit(deps, { kind: 'custom' }), 'USAGE', /needs a findings file/);
  await rejectsWith(
    review.submit(deps, { file: 'nowhere.json', kind: 'custom' }),
    'USAGE',
    /not found/,
  );

  await writeFile(join(deps.store.root, 'broken.json'), '{ not json');
  await rejectsWith(
    review.submit(deps, { file: 'broken.json', kind: 'custom' }),
    'VALIDATION',
    /not valid JSON/,
  );
});

test('a submit with no findings writes nothing and records no event', async () => {
  const { deps } = await workspace();
  const file = await findingsFile(deps, 'clean.json', { findings: [] });

  const result = await review.submit(deps, { file, kind: 'methodology' });
  assert.deepEqual(result.created, []);
  assert.deepEqual(await deps.store.listEntities('review'), []);
  assert.deepEqual(await events(deps), []);
});

test('review list filters by status and kind, and show returns one record', async () => {
  const { deps } = await workspace();
  const file = await findingsFile(deps, 'findings.json', {
    findings: [
      { target: 'project', severity: 'major', message: 'One.' },
      { target: 'project', severity: 'minor', message: 'Two.' },
    ],
  });
  const { created } = await review.submit(deps, { file, kind: 'reviewer2' });
  await review.accept(deps, created[0].id);

  assert.equal((await review.list(deps)).length, 2);
  assert.equal((await review.list(deps, { status: 'open' })).length, 1);
  assert.equal((await review.list(deps, { status: 'accepted' })).length, 1);
  assert.equal((await review.list(deps, { kind: 'reviewer2' })).length, 2);
  assert.equal((await review.list(deps, { kind: 'methodology' })).length, 0);

  await rejectsWith(review.list(deps, { status: 'pending' }), 'USAGE', /unknown status/);
  await rejectsWith(review.list(deps, { kind: 'vibes' }), 'USAGE', /unknown review kind/);

  const shown = await review.show(deps, created[0].id);
  assert.equal(shown.id, created[0].id);
  await rejectsWith(review.show(deps, 'REVIEW-9999999999'), 'USAGE', /not found/);
});

test('an open finding is accepted then resolved, each move recording one event', async () => {
  const { deps } = await workspace();
  const file = await findingsFile(deps, 'findings.json', {
    findings: [
      { target: 'project', severity: 'block', message: 'The comparison has no baseline.' },
    ],
  });
  const { created } = await review.submit(deps, { file, kind: 'reviewer2' });
  const id = created[0].id;

  const accepted = await review.accept(deps, id);
  assert.equal(accepted.changed, true);
  assert.equal(accepted.review.status, 'accepted');

  const resolved = await review.resolve(deps, id);
  assert.equal(resolved.review.status, 'resolved');
  assert.ok(resolved.review.resolved, 'a closed finding records when it closed');

  const recorded = await events(deps);
  assert.equal(recorded.length, 3);
  assert.match(recorded[1].summary, /open → accepted/);
  assert.match(recorded[2].summary, /accepted → resolved/);
});

test('a finding can only move where the lifecycle allows, and repeating a move is a no-op', async () => {
  const { deps } = await workspace();
  const file = await findingsFile(deps, 'findings.json', {
    findings: [
      { target: 'project', severity: 'major', message: 'One.' },
      { target: 'project', severity: 'major', message: 'Two.' },
    ],
  });
  const { created } = await review.submit(deps, { file, kind: 'reviewer2' });
  const [first, second] = created.map((item) => item.id);

  await rejectsWith(review.resolve(deps, first), 'VALIDATION', /cannot move .* from open/);

  await review.accept(deps, first);
  await rejectsWith(review.dismiss(deps, first), 'VALIDATION', /cannot move .* from accepted/);

  const again = await review.accept(deps, first);
  assert.equal(again.changed, false, 'accepting an accepted finding changes nothing');

  await review.dismiss(deps, second, { reason: 'answered in the methods' });
  await assert.rejects(
    () => review.accept(deps, second),
    (err) => {
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /cannot move .* from dismissed/);
      assert.match(err.hint, /a closed finding stays closed/);
      return true;
    },
  );

  const recorded = await events(deps);
  assert.equal(recorded.length, 3, 'submit, accept, dismiss - the refusals record nothing');
});

test('a transition refuses a workspace that needs migration', async () => {
  const { deps } = await workspace();
  const file = await findingsFile(deps, 'findings.json', {
    findings: [{ target: 'project', severity: 'note', message: 'One.' }],
  });
  const { created } = await review.submit(deps, { file, kind: 'custom' });

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

  await rejectsWith(review.accept(deps, created[0].id), 'USAGE', /needs migration/);
});

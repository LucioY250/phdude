import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { addEntity } from '../../src/application/add.js';
import { approve as approveDecision, promote, propose } from '../../src/application/decide.js';
import { deslop } from '../../src/application/deslop.js';
import * as manuscript from '../../src/application/manuscript.js';
import { proseSection } from '../../src/application/prose.js';
import { write } from '../../src/application/write.js';
import { PhdudeError } from '../../src/domain/errors.js';
import { parseSectionFile } from '../../src/domain/manuscript.js';

const actor = { researcher: 'test', agent: 'node' };

function makeDeps(root) {
  let tick = 0;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
    actor,
    readText: (path) => readFile(join(root, path), 'utf8').catch(() => null),
    loadProfile: async () => null,
  };
}

// A workspace holding one source, one question, one supported claim assigned to the
// introduction, and a manuscript planning the six standard sections.
async function workspace() {
  const deps = makeDeps(await mkdtemp(join(tmpdir(), 'phdude-write-')));

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
  await promote(deps, claim.id, { to: 'supported' });
  await manuscript.init(deps, { title: 'A thesis', language: 'en' });

  return { deps, source, question, evidence, claim };
}

async function file(deps, name, text) {
  await writeFile(join(deps.store.root, name), text);
  return name;
}

function draftFor(claimId, key) {
  return [
    `Small firms move toward automated tooling at their own pace, and the surveyed population`,
    `shows the same lag in every recruitment channel we examined [@${key}].`,
    `<!-- claim: ${claimId} -->`,
    '',
    'The gap matters because the firms that lag have the least slack to recover it. This section',
    'sets out the question the rest of the thesis answers.',
  ].join('\n');
}

function rejectsWith(promise, code, match) {
  return assert.rejects(promise, (err) => {
    assert.ok(err instanceof PhdudeError, `expected PhdudeError, got ${err}`);
    assert.equal(err.code, code, err.message);
    if (match) assert.match(`${err.message} ${err.hint ?? ''}`, match);
    return true;
  });
}

test('write assembles the context into the cache, prints the contract, and records nothing', async () => {
  const { deps, claim } = await workspace();
  const before = (await deps.store.readEvents()).length;

  const result = await write(deps, { section: 'introduction' });

  assert.equal(result.section.id, 'introduction');
  assert.match(result.path, /\.phdude[/\\]cache[/\\]writing[/\\]introduction[/\\]context\.md$/);
  assert.deepEqual(
    result.included.map((item) => item.kind),
    ['instruction', 'facts', 'claim', 'bibkeys', 'policy', 'voice', 'epistemic'],
  );
  assert.deepEqual(result.truncated, []);
  assert.deepEqual(result.voice, { id: 'project-consensus', found: false });
  assert.ok(result.contract.some((rule) => rule.includes('manuscript submit introduction')));

  const onDisk = await readFile(result.path, 'utf8');
  assert.equal(onDisk, result.markdown);
  assert.match(onDisk, new RegExp(`Assert it with: <!-- claim: ${claim.id} -->`));
  assert.match(onDisk, /\[@zeta2020adoption\]/);

  assert.equal((await deps.store.readEvents()).length, before, 'write records no event');
  assert.equal(await deps.store.exists(join('manuscript', 'introduction.md')), false);
});

test('write honours the budget and reports what it left out', async () => {
  const { deps } = await workspace();
  const result = await write(deps, { section: 'introduction', budget: '400' });

  assert.ok(result.included.length < 7);
  assert.ok(result.truncated.length > 0);
  assert.equal(result.included[0].kind, 'instruction');
  assert.equal(result.budget, 400);
});

test('write refuses an unknown section, a bad budget and a bad voice id', async () => {
  const { deps } = await workspace();
  await rejectsWith(write(deps, { section: 'appendix' }), 'USAGE', /unknown section/);
  await rejectsWith(
    write(deps, { section: 'introduction', budget: 'lots' }),
    'VALIDATION',
    /budget/,
  );
  await rejectsWith(
    write(deps, { section: 'introduction', voice: '../escape' }),
    'VALIDATION',
    /voice/,
  );
});

test('a draft whose verb outruns its claim is blocked, and writes no section file', async () => {
  const { deps, claim } = await workspace();
  const path = await file(
    deps,
    'bad.md',
    `Adoption demonstrates a clear lag [@zeta2020adoption].\n<!-- claim: ${claim.id} -->\n`,
  );

  await assert.rejects(manuscript.submit(deps, { section: 'introduction', file: path }), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /gate-evidence/);
    assert.match(err.details[0], /"demonstrates" claims more than the evidence supports/);
    return true;
  });

  // A block writes nothing at all: no section file, no report, no cache report, no event.
  assert.equal(await deps.store.exists(join('manuscript', 'introduction.md')), false);
  assert.equal(await deps.store.exists(join('manuscript', 'reports', 'introduction.yaml')), false);
  assert.equal(
    await deps.store.exists(join('.phdude', 'cache', 'writing', 'introduction', 'report.json')),
    false,
  );
  const events = await deps.store.readEvents();
  assert.equal(events.at(-1).summary, 'manuscript initialized (6 sections)');
});

test('a clean draft runs every gate, and stores both reports', async () => {
  const { deps, claim } = await workspace();
  const path = await file(deps, 'draft.md', draftFor(claim.id, 'zeta2020adoption'));

  const result = await manuscript.submit(deps, { section: 'introduction', file: path });
  assert.equal(result.section.status, 'draft');
  assert.deepEqual(
    result.report.gates.map((row) => row.gate),
    ['gate-citations', 'gate-evidence', 'gate-prose', 'gate-voice', 'gate-profile'],
  );
  assert.equal(result.report.scores.evidenceAlignment, 100);
  assert.equal(result.report.scores.epistemicPrecision, 100);
  assert.ok(!('authorVoice' in result.report.scores), 'a null sub-score is left out of the record');

  const cached = JSON.parse(
    await readFile(
      join(deps.store.root, '.phdude', 'cache', 'writing', 'introduction', 'report.json'),
      'utf8',
    ),
  );
  assert.equal(cached.blocked, false);
  assert.equal(cached.mode, 'full');
  assert.equal(cached.hash, result.report.hash);
});

test('deslop without a file prints the observations and the revision contract', async () => {
  const { deps, claim } = await workspace();
  const path = await file(deps, 'draft.md', draftFor(claim.id, 'zeta2020adoption'));
  await manuscript.submit(deps, { section: 'introduction', file: path });
  const before = (await deps.store.readEvents()).length;

  const result = await deslop(deps, { section: 'introduction' });
  assert.equal(result.revised, false);
  assert.ok(Array.isArray(result.observations));
  assert.equal(typeof result.scores.specificity, 'number');
  assert.ok(result.contract.preserve.some((rule) => rule.includes('negation')));

  assert.equal((await deps.store.readEvents()).length, before, 'the contract records no event');
});

test('deslop refuses a section with nothing written yet', async () => {
  const { deps } = await workspace();
  await rejectsWith(deslop(deps, { section: 'introduction' }), 'USAGE', /nothing written yet/);
});

test('a revision that drops a citation is blocked and changes nothing', async () => {
  const { deps, claim } = await workspace();
  const path = await file(deps, 'draft.md', draftFor(claim.id, 'zeta2020adoption'));
  const submitted = await manuscript.submit(deps, { section: 'introduction', file: path });

  const revision = await file(
    deps,
    'revision.md',
    draftFor(claim.id, 'zeta2020adoption').replace(' [@zeta2020adoption]', ''),
  );

  await assert.rejects(deslop(deps, { section: 'introduction', file: revision }), (err) => {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /gate-meaning/);
    assert.match(err.details[0], /drops the citation zeta2020adoption/);
    return true;
  });

  const onDisk = await deps.store.readManuscript();
  const entry = onDisk.sections.find((s) => s.id === 'introduction');
  assert.equal(entry.status, 'draft');
  assert.equal(entry.hash, submitted.report.hash);
  const events = await deps.store.readEvents();
  assert.equal(events.at(-1).summary, 'submitted introduction (draft)');
});

test('a revision that keeps the meaning is recorded as revised, with one event', async () => {
  const { deps, claim } = await workspace();
  const path = await file(deps, 'draft.md', draftFor(claim.id, 'zeta2020adoption'));
  await manuscript.submit(deps, { section: 'introduction', file: path });

  const revised = [
    'Across every recruitment channel we examined, small firms move toward automated tooling at',
    'their own pace [@zeta2020adoption].',
    `<!-- claim: ${claim.id} -->`,
    '',
    'The firms that lag have the least slack to recover it, which is why the gap matters. This',
    'section sets out the question the rest of the thesis answers.',
  ].join('\n');
  const revision = await file(deps, 'revision.md', revised);

  const result = await deslop(deps, { section: 'introduction', file: revision });
  assert.equal(result.revised, true);
  assert.equal(result.section.status, 'revised');
  assert.ok(result.report.gates.some((row) => row.gate === 'gate-meaning'));

  const text = await deps.store.readSection('manuscript/introduction.md');
  assert.equal(parseSectionFile(text).front.status, 'revised');
  assert.equal(parseSectionFile(text).body.trim(), revised.trim());

  const events = await deps.store.readEvents();
  assert.equal(events.at(-1).summary, 'deslop introduction (revised)');
  assert.equal(
    events.filter((e) => e.summary.startsWith('deslop')).length,
    1,
    'exactly one event per revision',
  );
});

test('--allow-additions lets a revision add a claim the researcher asked for', async () => {
  const { deps, claim } = await workspace();
  const path = await file(deps, 'draft.md', draftFor(claim.id, 'zeta2020adoption'));
  await manuscript.submit(deps, { section: 'introduction', file: path });

  const { obj: second } = await addEntity(deps, 'claim', {
    statement: 'The lag is widest in firms below ten employees.',
    kind: 'empirical',
    supported_by: [],
  });
  const added = `${draftFor(claim.id, 'zeta2020adoption')}\n\nThe lag is widest in the smallest firms.\n<!-- claim: ${second.id} -->\n`;
  const revision = await file(deps, 'revision.md', added);

  await rejectsWith(
    deslop(deps, { section: 'introduction', file: revision }),
    'VALIDATION',
    /gate-meaning/,
  );

  const result = await deslop(deps, {
    section: 'introduction',
    file: revision,
    allowAdditions: true,
  });
  assert.equal(result.revised, true);
});

test('prose on a section scores against the evidence graph and stores the scores', async () => {
  const { deps, claim } = await workspace();
  const path = await file(deps, 'draft.md', draftFor(claim.id, 'zeta2020adoption'));
  await manuscript.submit(deps, { section: 'introduction', file: path });
  const before = (await deps.store.readEvents()).length;

  const report = await proseSection(deps, 'introduction');
  assert.equal(report.section.id, 'introduction');
  assert.equal(typeof report.scores.evidenceAlignment, 'number');
  assert.equal(typeof report.scores.epistemicPrecision, 'number');
  assert.equal(report.scores.authorVoice, null, 'the voice profiles are not here yet');
  assert.equal(typeof report.aggregate, 'number');

  const stored = await deps.store.readReport('introduction');
  assert.equal(stored.scores.evidenceAlignment, report.scores.evidenceAlignment);
  assert.ok(!('authorVoice' in stored.scores));

  assert.equal((await deps.store.readEvents()).length, before, 'a report records no event');
});

test('prose refuses a planned section, and an approved section refuses deslop', async () => {
  const { deps, claim } = await workspace();
  await rejectsWith(proseSection(deps, 'methods'), 'USAGE', /nothing written yet/);

  const path = await file(deps, 'draft.md', draftFor(claim.id, 'zeta2020adoption'));
  await manuscript.submit(deps, { section: 'introduction', file: path });

  const { obj: decision } = await propose(deps, {
    title: 'Approve the introduction',
    rationale: 'It reads as intended.',
    affects: ['manuscript:introduction'],
  });
  await approveDecision(deps, decision.id, { by: 'the researcher' });
  await manuscript.approve(deps, { section: 'introduction', decision: decision.id });
  await rejectsWith(deslop(deps, { section: 'introduction' }), 'POLICY', /reopen/);

  await manuscript.reopen(deps, { section: 'introduction' });
  const result = await deslop(deps, { section: 'introduction' });
  assert.equal(result.revised, false);
});

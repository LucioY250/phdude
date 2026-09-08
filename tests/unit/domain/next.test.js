import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendNext } from '../../../src/domain/next.js';
import { detectFactConflicts } from '../../../src/domain/conflicts.js';
import { makeHashId } from '../../../src/domain/ids.js';

const created = '2026-09-07T00:00:00Z';
const NOW = '2026-09-07T12:00:00Z';
const actor = { researcher: 'test' };

function emptySnapshot(overrides = {}) {
  return {
    project: { title: 'T', fields: [], methods: [], outputs: ['thesis'], mode: 'full' },
    artifacts: [],
    sources: [],
    claims: [],
    evidence: [],
    facts: [],
    results: [],
    questions: [],
    hypotheses: [],
    candidates: [],
    searches: [],
    decisions: [],
    now: NOW,
    staleAfterDays: 180,
    ...overrides,
  };
}

// A search run six days ago: recent enough that the freshness rules stay out of the way of
// whatever the test around it is actually about.
function search(id, questionId, lastRun = '2026-09-01T00:00:00Z') {
  return {
    id,
    schema: 'phdude.search',
    version: 1,
    created,
    actor,
    question: questionId,
    last_run: lastRun,
  };
}

function artifact(id, status, warnings = []) {
  return {
    id,
    schema: 'phdude.artifact',
    version: 1,
    created,
    actor,
    path: `sources/${id}.pdf`,
    paths: [`sources/${id}.pdf`],
    hash: 'a'.repeat(64),
    bytes: 10,
    mime: 'application/pdf',
    kind: 'pdf',
    role: 'unknown',
    extracted: { status, method: '', text_chars: 0, sections: 0, tables: 0, warnings },
    mtime: created,
  };
}

function fact(id, key, value, artifactId, unit = undefined) {
  const from = { artifact: artifactId };
  const obj = {
    id,
    schema: 'phdude.fact',
    version: 1,
    created,
    actor,
    key,
    value,
    from,
    state: 'canonical',
  };
  if (unit !== undefined) obj.unit = unit;
  return obj;
}

function claim(id, { state = 'candidate', supported_by = [], questions = [] } = {}) {
  return {
    id,
    schema: 'phdude.claim',
    version: 1,
    created,
    actor,
    statement: `statement ${id}`,
    kind: 'empirical',
    state,
    supported_by,
    questions,
    sections: [],
  };
}

function evidence(id, source) {
  return {
    id,
    schema: 'phdude.evidence',
    version: 1,
    created,
    actor,
    source,
    locator: '',
    excerpt: `excerpt ${id}`,
    strength: 'moderate',
    state: 'candidate',
  };
}

function question(id) {
  return {
    id,
    schema: 'phdude.question',
    version: 1,
    created,
    actor,
    text: `text ${id}`,
    objectives: [],
    state: 'candidate',
  };
}

test('recommendNext: empty snapshot -> top is no-questions', () => {
  const snapshot = emptySnapshot();
  const actions = recommendNext(snapshot, []);
  assert.equal(actions[0].rule, 'no-questions');
  assert.equal(actions[0].impact, 'high');
  assert.ok(actions[0].why.length > 0);
  assert.equal(actions.at(-1).rule, 'consistent');
  assert.equal(
    actions.at(-1).action,
    'No further automatic recommendations; add new sources or refine claims',
    'consistent must not claim the workspace is consistent when another action is above it',
  );
});

test('recommendNext: RQ present + one unavailable artifact -> rule 2 top, hint in why', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    artifacts: [
      artifact('ART-aaaaaaaaaa', 'unavailable', [
        'pdftotext parser unavailable: install poppler-utils',
      ]),
    ],
  });
  const actions = recommendNext(snapshot, []);
  assert.equal(actions[0].rule, 'extraction-unavailable');
  assert.equal(actions[0].impact, 'high');
  assert.ok(
    actions[0].why.some((w) => w.includes('install poppler-utils')),
    'why should include the install hint from the artifact warning',
  );
});

test('recommendNext: conflict with 3 dependent claims outranks unsupported-claims with 1 dependent', () => {
  const facts = [
    fact('FACT-0000000001', 'sample_size', 312, 'ART-a'),
    fact('FACT-0000000002', 'sample_size', 300, 'ART-b'),
  ];
  const conflicts = detectFactConflicts(facts, []);
  assert.equal(conflicts.length, 1);

  const ev1 = evidence('EVID-0000000001', 'ART-a');
  const ev2 = evidence('EVID-0000000002', 'ART-a');
  const ev3 = evidence('EVID-0000000003', 'ART-b');

  const dependentClaims = [
    claim('CLAIM-0000000001', { state: 'candidate', supported_by: [ev1.id] }),
    claim('CLAIM-0000000002', { state: 'candidate', supported_by: [ev2.id] }),
    claim('CLAIM-0000000003', { state: 'candidate', supported_by: [ev3.id] }),
  ];
  const unsupportedClaim = claim('CLAIM-0000000004', { state: 'supported', supported_by: [] });

  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    artifacts: [artifact('ART-a', 'ok'), artifact('ART-b', 'ok')],
    facts,
    evidence: [ev1, ev2, ev3],
    claims: [...dependentClaims, unsupportedClaim],
  });

  const actions = recommendNext(snapshot, conflicts);
  const openConflictAction = actions.find((a) => a.rule === 'open-conflicts');
  const unsupportedAction = actions.find((a) => a.rule === 'unsupported-claims');

  assert.ok(openConflictAction);
  assert.ok(unsupportedAction);
  assert.equal(openConflictAction.dependents, 3);
  assert.equal(unsupportedAction.dependents, 1);
  assert.equal(actions[0].rule, 'open-conflicts');
  assert.ok(actions.indexOf(openConflictAction) < actions.indexOf(unsupportedAction));
});

test('recommendNext: unsupported-claims suggests a link command naming the claim', () => {
  const unsupported = claim('CLAIM-0000000004', { state: 'supported', supported_by: [] });
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    claims: [unsupported],
  });

  const action = recommendNext(snapshot, []).find((a) => a.rule === 'unsupported-claims');
  assert.ok(action);
  assert.equal(action.command, `phdude link ${unsupported.id} --to <EVID-id>`);
});

test('recommendNext: fully consistent workspace -> only consistent action', () => {
  const snapshot = uncitedSourcesSnapshot(0);

  const actions = recommendNext(snapshot, []);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].rule, 'consistent');
  assert.equal(actions[0].impact, 'low');
  assert.ok(actions[0].why.length > 0);
  assert.equal(actions[0].action, 'Workspace is consistent; add new sources or refine claims');
});

test('recommendNext: candidate-backlog does not fire below 5 candidates', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    claims: [
      claim('CLAIM-0000000001'),
      claim('CLAIM-0000000002'),
      claim('CLAIM-0000000003'),
      claim('CLAIM-0000000004'),
    ],
  });
  const actions = recommendNext(snapshot, []);
  assert.ok(!actions.some((a) => a.rule === 'candidate-backlog'));
});

test('recommendNext: candidate-backlog fires at exactly 5 candidates', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    claims: [
      claim('CLAIM-0000000001'),
      claim('CLAIM-0000000002'),
      claim('CLAIM-0000000003'),
      claim('CLAIM-0000000004'),
      claim('CLAIM-0000000005'),
    ],
  });
  const actions = recommendNext(snapshot, []);
  const backlog = actions.find((a) => a.rule === 'candidate-backlog');
  assert.ok(backlog, 'candidate-backlog should fire at the 5-candidate threshold');
  assert.equal(backlog.impact, 'medium');
  assert.equal(backlog.dependents, 5);
});

test('recommendNext: packs-recommended fires only for recommended packs not yet applied', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    project: {
      title: 'T',
      fields: ['humanities'],
      methods: [],
      outputs: ['thesis'],
      mode: 'full',
      packs_recommended: ['humanities', 'qualitative'],
    },
  });
  const actions = recommendNext(snapshot, []);
  const packsAction = actions.find((a) => a.rule === 'packs-recommended');
  assert.ok(packsAction, 'qualitative is recommended but not applied, so the rule should fire');
  assert.equal(packsAction.impact, 'medium');
  assert.equal(packsAction.dependents, 1);
  assert.ok(packsAction.why.some((w) => w.includes('qualitative')));
  assert.ok(
    !packsAction.why.some((w) => w.includes('humanities')),
    'humanities is already applied',
  );
  assert.equal(packsAction.command, 'phdude packs apply qualitative');
});

test('recommendNext: packs-recommended does not fire once every recommendation is applied', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    project: {
      title: 'T',
      fields: ['humanities'],
      methods: [],
      outputs: ['thesis'],
      mode: 'full',
      packs_recommended: ['humanities'],
    },
  });
  const actions = recommendNext(snapshot, []);
  assert.ok(!actions.some((a) => a.rule === 'packs-recommended'));
});

test('recommendNext: question-gaps fires for an RQ with zero claims addressing it', () => {
  const rq1 = question('RQ-1');
  const rq2 = question('RQ-2');
  const addressingClaim = claim('CLAIM-0000000001', { questions: [rq1.id] });

  const snapshot = emptySnapshot({ questions: [rq1, rq2], claims: [addressingClaim] });
  const actions = recommendNext(snapshot, []);
  const gapAction = actions.find((a) => a.rule === 'question-gaps');
  assert.ok(gapAction, 'RQ-2 has no addressing claim, so the rule should fire');
  assert.equal(gapAction.dependents, 1);
  assert.ok(gapAction.why.some((w) => w.includes('RQ-2')));
  assert.ok(!gapAction.why.some((w) => w.includes('RQ-1')), 'RQ-1 is addressed and not a gap');
  assert.equal(
    gapAction.command,
    `phdude add claim --json '{"statement":"…","questions":["RQ-2"]}'`,
  );
});

test('recommendNext: question-gaps does not fire once every RQ is addressed', () => {
  const rq = question('RQ-1');
  const addressingClaim = claim('CLAIM-0000000001', { questions: [rq.id] });
  const snapshot = emptySnapshot({ questions: [rq], claims: [addressingClaim] });
  const actions = recommendNext(snapshot, []);
  assert.ok(!actions.some((a) => a.rule === 'question-gaps'));
});

test('recommendNext: every action has non-empty why, valid impact, string command, numeric dependents', () => {
  const snapshot = emptySnapshot({
    questions: [],
    artifacts: [artifact('ART-a', 'failed', ['boom'])],
    claims: [claim('CLAIM-0000000001', { state: 'canonical', supported_by: [] })],
  });
  const actions = recommendNext(snapshot, []);
  for (const a of actions) {
    assert.ok(Array.isArray(a.why) && a.why.length > 0, `${a.rule} why must be non-empty`);
    assert.ok(['high', 'medium', 'low'].includes(a.impact));
    assert.equal(typeof a.command, 'string');
    assert.equal(typeof a.dependents, 'number');
  }
});

// A fully-addressed, fully-methoded RQ (so no other rule, question-gaps included, fires) plus
// `count` never-cited sources - each an isolated low-severity `uncited-source` gap and nothing
// else, so the gaps rule's threshold and its "no high rule fired" guard can be tested in
// isolation.
function uncitedSourcesSnapshot(count) {
  const rq = question('RQ-1');
  const addressingClaim = claim('CLAIM-0000000001', {
    state: 'supported',
    supported_by: ['EVID-0000000001'],
    questions: [rq.id],
  });
  const ev = evidence('EVID-0000000001', 'ART-a');
  const art = artifact('ART-a', 'ok');
  art.role = 'paper';
  const meth = {
    id: 'METH-0000000001',
    schema: 'phdude.method',
    version: 1,
    created,
    actor,
    name: 'A method',
    design: 'design',
    paradigm: 'quantitative',
    questions: [rq.id],
    state: 'candidate',
  };

  const sources = Array.from({ length: count }, (_, i) => ({
    id: `SRC-000000000${i}`,
    schema: 'phdude.source',
    version: 1,
    created,
    actor,
    title: `Source ${i}`,
    authors: ['A. One'],
    year: 2020,
    type: 'article',
    artifacts: [],
    state: 'candidate',
  }));

  return emptySnapshot({
    questions: [rq],
    claims: [addressingClaim],
    evidence: [ev],
    artifacts: [art],
    sources,
    methods: [meth],
    searches: [search('SEARCH-0000000001', rq.id)],
  });
}

test('recommendNext: gaps fires at >= 3 gaps when no high-impact rule fired', () => {
  const actions = recommendNext(uncitedSourcesSnapshot(3), []);
  const gapsAction = actions.find((a) => a.rule === 'gaps');
  assert.ok(gapsAction, '3 uncited-source gaps and no high rule should fire the gaps rule');
  assert.equal(gapsAction.impact, 'medium');
  assert.equal(gapsAction.command, 'phdude gaps');
  assert.equal(gapsAction.dependents, 3);
  assert.ok(gapsAction.why.some((w) => /low=3/.test(w)));
});

test('recommendNext: gaps does not fire below the 3-gap threshold', () => {
  const actions = recommendNext(uncitedSourcesSnapshot(2), []);
  assert.ok(!actions.some((a) => a.rule === 'gaps'));
});

test('recommendNext: gaps still fires when a high-impact rule has already fired', () => {
  const snapshot = uncitedSourcesSnapshot(3);
  snapshot.artifacts.push(artifact('ART-bad', 'failed', ['boom']));
  const actions = recommendNext(snapshot, []);
  assert.ok(actions.some((a) => a.rule === 'extraction-unavailable' && a.impact === 'high'));
  assert.ok(
    actions.some((a) => a.rule === 'gaps'),
    'the ranking, not the rule, decides order',
  );
});

test('recommendNext: gaps fires on a single high-severity gap, below the 3-gap threshold', () => {
  const snapshot = uncitedSourcesSnapshot(0);
  snapshot.questions.push(question('RQ-2'));
  snapshot.searches.push(search('SEARCH-0000000002', 'RQ-2'));
  const actions = recommendNext(snapshot, []);
  const gapsAction = actions.find((a) => a.rule === 'gaps');
  assert.ok(gapsAction, 'an unaddressed question is a high gap and outranks the count');
  assert.ok(gapsAction.why.some((w) => /high=1/.test(w)));
  assert.ok(gapsAction.dependents < 3);
});

test('recommendNext: consistent reports the open gaps rather than claiming consistency', () => {
  const actions = recommendNext(uncitedSourcesSnapshot(2), []);
  assert.ok(!actions.some((a) => a.rule === 'gaps'), '2 low gaps stay below the threshold');

  const consistent = actions.at(-1);
  assert.equal(consistent.rule, 'consistent');
  assert.equal(consistent.action, '2 open gap(s); run phdude gaps');
  assert.equal(consistent.impact, 'low');
  assert.deepEqual(consistent.why, ['2 gap(s) found: high=0, medium=0, low=2']);
});

test('recommendNext: consistent claims consistency only with zero gaps', () => {
  const actions = recommendNext(uncitedSourcesSnapshot(0), []);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'Workspace is consistent; add new sources or refine claims');
});

test('recommendNext: gaps is ordered after question-gaps and before consistent', () => {
  const actions = recommendNext(uncitedSourcesSnapshot(3), []);
  const gapsIndex = actions.findIndex((a) => a.rule === 'gaps');
  const consistentIndex = actions.findIndex((a) => a.rule === 'consistent');
  assert.ok(gapsIndex !== -1 && consistentIndex !== -1);
  assert.ok(gapsIndex < consistentIndex);
});

test('recommendNext: stale-search fires for a question whose search has aged past the policy', () => {
  const rq = question('RQ-1');
  const snapshot = emptySnapshot({
    questions: [rq],
    claims: [claim('CLAIM-0000000001', { questions: [rq.id] })],
    searches: [search('SEARCH-0000000001', rq.id, '2026-01-01T12:00:00Z')],
  });

  const action = recommendNext(snapshot, []).find((a) => a.rule === 'stale-search');

  assert.ok(action);
  assert.equal(action.impact, 'medium');
  assert.equal(action.dependents, 1);
  assert.equal(action.command, 'phdude research-fresh --question RQ-1');
  assert.ok(action.why.some((w) => /249 day\(s\) ago \(stale after 180\)/.test(w)));
});

test('recommendNext: stale-search points at a first search when the question has never had one', () => {
  const rq = question('RQ-1');
  const snapshot = emptySnapshot({ questions: [rq] });

  const action = recommendNext(snapshot, []).find((a) => a.rule === 'stale-search');

  assert.ok(action);
  assert.equal(action.command, `phdude research "text RQ-1" --question RQ-1`);
  assert.ok(action.why.some((w) => /never been searched/.test(w)));
});

test('recommendNext: stale-search counts never-searched questions in the right number', () => {
  const why = (questions) =>
    recommendNext(emptySnapshot({ questions }), []).find((a) => a.rule === 'stale-search').why;

  // The why line is read aloud to the researcher; "1 of them have never been searched" reads as
  // a bug in the count rather than as a sentence.
  assert.ok(why([question('RQ-1')]).includes('1 of them has never been searched'));
  assert.ok(
    why([question('RQ-1'), question('RQ-2')]).includes('2 of them have never been searched'),
  );
});

test('recommendNext: stale-search does not fire while every question has a current search', () => {
  const rq = question('RQ-1');
  const snapshot = emptySnapshot({
    questions: [rq],
    searches: [search('SEARCH-0000000001', rq.id)],
  });

  assert.ok(!recommendNext(snapshot, []).some((a) => a.rule === 'stale-search'));
});

test('recommendNext: stale-search does not fire in a workspace with no questions', () => {
  assert.ok(!recommendNext(emptySnapshot(), []).some((a) => a.rule === 'stale-search'));
});

function candidate(id, state = 'candidate') {
  return { id, schema: 'phdude.candidate', version: 1, created, actor, state };
}

test('recommendNext: candidates-pending fires at 5 unreviewed candidates', () => {
  const candidates = Array.from({ length: 5 }, (_, i) => candidate(`CAND-000000000${i}`));
  const action = recommendNext(emptySnapshot({ candidates }), []).find(
    (a) => a.rule === 'candidates-pending',
  );

  assert.ok(action);
  assert.equal(action.impact, 'medium');
  assert.equal(action.dependents, 5);
  assert.equal(action.command, 'phdude research list --state candidate');
});

test('recommendNext: candidates-pending does not fire below 5, and counts only unreviewed ones', () => {
  const four = Array.from({ length: 4 }, (_, i) => candidate(`CAND-000000000${i}`));
  assert.ok(
    !recommendNext(emptySnapshot({ candidates: four }), []).some(
      (a) => a.rule === 'candidates-pending',
    ),
  );

  const mixed = [...four, candidate('CAND-0000000009', 'accepted')];
  assert.ok(
    !recommendNext(emptySnapshot({ candidates: mixed }), []).some(
      (a) => a.rule === 'candidates-pending',
    ),
    'an accepted candidate is not waiting for a verdict',
  );
});

test('recommendNext: stale-search opens the network policy first when it is closed', () => {
  const rq = question('RQ-1');
  const never = recommendNext(emptySnapshot({ questions: [rq], networkEnabled: false }), []).find(
    (a) => a.rule === 'stale-search',
  );

  assert.equal(
    never.command,
    'set network.enabled: true in .phdude/research-policy.yaml, then phdude research "text RQ-1" --question RQ-1',
  );

  const aged = recommendNext(
    emptySnapshot({
      questions: [rq],
      searches: [search('SEARCH-0000000001', rq.id, '2026-01-01T12:00:00Z')],
      networkEnabled: false,
    }),
    [],
  ).find((a) => a.rule === 'stale-search');

  assert.equal(
    aged.command,
    'set network.enabled: true in .phdude/research-policy.yaml, then phdude research-fresh --question RQ-1',
  );
});

test('recommendNext: stale-search recommends the search itself when the network is open', () => {
  const rq = question('RQ-1');
  const action = recommendNext(emptySnapshot({ questions: [rq], networkEnabled: true }), []).find(
    (a) => a.rule === 'stale-search',
  );

  assert.equal(action.command, `phdude research "text RQ-1" --question RQ-1`);
});

// A manuscript with one section, so a case can say exactly which state it is testing.
function manuscript(section = {}) {
  return {
    schema: 'phdude.manuscript',
    version: 1,
    title: 'T',
    language: 'en',
    voice: { kind: 'consensus' },
    sections: [
      {
        id: 'introduction',
        title: 'Introduction',
        file: 'manuscript/introduction.md',
        order: 1,
        status: 'planned',
        hash: null,
        claims: [],
        questions: [],
        ...section,
      },
    ],
  };
}

test('recommendNext: sections-planned fires when a planned section has supported claims behind it', () => {
  const ready = claim('CLAIM-1', { state: 'supported', supported_by: ['EVID-1'] });
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    claims: [ready],
    evidence: [evidence('EVID-1', 'SRC-1')],
    manuscript: manuscript({ claims: ['CLAIM-1'] }),
  });

  const action = recommendNext(snapshot, []).find((a) => a.rule === 'sections-planned');
  assert.ok(action);
  assert.equal(action.impact, 'medium');
  assert.equal(action.command, 'phdude write introduction');
  assert.match(action.why[0], /introduction/);
});

test('recommendNext: a planned section whose claims are still candidates is not ready to write', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    claims: [claim('CLAIM-1', { state: 'candidate' })],
    manuscript: manuscript({ claims: ['CLAIM-1'] }),
  });
  assert.equal(
    recommendNext(snapshot, []).some((a) => a.rule === 'sections-planned'),
    false,
  );
});

test('recommendNext: draft-blocked is high and reads the last section report', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    manuscript: manuscript({ status: 'draft' }),
    sectionReports: [{ section: 'introduction', blocks: 2, warnings: 1 }],
  });

  const action = recommendNext(snapshot, []).find((a) => a.rule === 'draft-blocked');
  assert.ok(action);
  assert.equal(action.impact, 'high');
  assert.equal(action.command, 'phdude prose introduction');
  assert.match(action.why[0], /introduction \(2\)/);
});

test('recommendNext: approval-pending names the revised sections with no decision behind them', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    manuscript: manuscript({ status: 'revised' }),
  });

  const action = recommendNext(snapshot, []).find((a) => a.rule === 'approval-pending');
  assert.ok(action);
  assert.equal(action.impact, 'medium');
  assert.match(action.command, /--affects manuscript:introduction/);

  const approved = emptySnapshot({
    questions: [question('RQ-1')],
    manuscript: manuscript({ status: 'approved', approved_by: 'DEC-1' }),
  });
  assert.equal(
    recommendNext(approved, []).some((a) => a.rule === 'approval-pending'),
    false,
  );
});

test('recommendNext: a workspace with no manuscript recommends none of the writing rules', () => {
  const snapshot = emptySnapshot({ questions: [question('RQ-1')] });
  const rules = recommendNext(snapshot, []).map((a) => a.rule);
  for (const rule of ['sections-planned', 'draft-blocked', 'approval-pending']) {
    assert.equal(rules.includes(rule), false, rule);
  }
});

function result(id, from, overrides = {}) {
  return {
    id,
    schema: 'phdude.result',
    version: 1,
    created,
    actor,
    summary: `summary ${id}`,
    from,
    values: { n: 1 },
    state: 'candidate',
    ...overrides,
  };
}

function reproItem(kind, id, status, name = 'item') {
  return { kind, id, name, status, reasons: [] };
}

function reviewFinding(id, severity, status = 'open', overrides = {}) {
  return {
    id,
    schema: 'phdude.review',
    version: 1,
    created,
    actor,
    kind: 'reviewer2',
    target: 'project',
    severity,
    message: `A ${severity} finding.`,
    evidence: [],
    status,
    by: actor,
    mode: 'full',
    ...overrides,
  };
}

test('recommendNext: reviews-open counts the open findings and names the worst one', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    reviews: [
      reviewFinding('REVIEW-1111111111', 'minor'),
      reviewFinding('REVIEW-2222222222', 'block'),
      reviewFinding('REVIEW-3333333333', 'major'),
      reviewFinding('REVIEW-4444444444', 'block', 'dismissed'),
    ],
  });

  const action = recommendNext(snapshot, []).find((a) => a.rule === 'reviews-open');
  assert.ok(action);
  assert.equal(action.impact, 'high');
  assert.equal(action.dependents, 3, 'the dismissed finding is closed');
  assert.match(action.why[0], /3 review finding\(s\) are open: block=1, major=1, minor=1/);
  assert.match(action.why[1], /REVIEW-2222222222, REVIEW-3333333333/);
  assert.equal(action.command, 'phdude review show REVIEW-2222222222');
});

test('recommendNext: open findings that are only minor or note are medium, not high', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    reviews: [
      reviewFinding('REVIEW-1111111111', 'minor'),
      reviewFinding('REVIEW-2222222222', 'note'),
    ],
  });

  const action = recommendNext(snapshot, []).find((a) => a.rule === 'reviews-open');
  assert.equal(action.impact, 'medium');
  assert.equal(action.why.length, 1, 'nothing blocks, so nothing is said about blocking');
});

test('recommendNext: ruthless mode promotes a minor finding into a blocking recommendation', () => {
  const reviews = [reviewFinding('REVIEW-1111111111', 'minor')];
  const full = emptySnapshot({ questions: [question('RQ-1')], reviews });
  const ruthless = emptySnapshot({
    questions: [question('RQ-1')],
    project: { title: 'T', fields: [], methods: [], outputs: ['thesis'], mode: 'ruthless' },
    reviews,
  });

  assert.equal(recommendNext(full, []).find((a) => a.rule === 'reviews-open').impact, 'medium');

  const promoted = recommendNext(ruthless, []).find((a) => a.rule === 'reviews-open');
  assert.equal(promoted.impact, 'high');
  assert.match(promoted.why[2], /review mode is ruthless/);
  assert.equal(reviews[0].severity, 'minor', 'the stored severity is untouched');
});

test('recommendNext: a workspace with no review findings makes no reviews-open recommendation', () => {
  const snapshot = emptySnapshot({ questions: [question('RQ-1')], reviews: [] });
  assert.equal(
    recommendNext(snapshot, []).find((a) => a.rule === 'reviews-open'),
    undefined,
  );
});

test('recommendNext: analysis-stale is medium while nothing has been said out loud yet', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    executionEnabled: true,
    results: [result('RESULT-1', 'ANALYSIS-1')],
    repro: [reproItem('analysis', 'ANALYSIS-1', 'stale', 'describe')],
  });

  const action = recommendNext(snapshot, []).find((a) => a.rule === 'analysis-stale');
  assert.ok(action);
  assert.equal(action.impact, 'medium');
  assert.equal(action.dependents, 1);
  assert.equal(action.command, 'phdude analyze run ANALYSIS-1');
  assert.match(action.why[0], /ANALYSIS-1 \(describe\) read inputs that have changed/);
});

test('recommendNext: analysis-stale is high once a supported claim rests on one of its results', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    executionEnabled: true,
    results: [result('RESULT-1', 'ANALYSIS-1')],
    evidence: [evidence('EVID-1', 'RESULT-1')],
    claims: [claim('CLAIM-1', { state: 'supported', supported_by: ['EVID-1'] })],
    repro: [reproItem('analysis', 'ANALYSIS-1', 'stale', 'describe')],
  });

  const action = recommendNext(snapshot, []).find((a) => a.rule === 'analysis-stale');
  assert.equal(action.impact, 'high');
  assert.match(action.why.at(-1), /RESULT-1/);
});

test('recommendNext: analysis-stale opens the execution policy first when it is closed', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    executionEnabled: false,
    repro: [reproItem('analysis', 'ANALYSIS-1', 'stale', 'describe')],
  });

  const action = recommendNext(snapshot, []).find((a) => a.rule === 'analysis-stale');
  assert.match(action.command, /^set execution\.enabled: true .*, then phdude analyze run/);
});

test('recommendNext: a table or a figure that is stale is not an analysis-stale recommendation', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    repro: [reproItem('table', 'TABLE-1', 'stale'), reproItem('figure', 'FIG-1', 'stale')],
  });
  assert.equal(
    recommendNext(snapshot, []).some((a) => a.rule === 'analysis-stale'),
    false,
  );
});

test('recommendNext: figure-missing-alt names the figures whose alt text was edited away', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    figures: [
      { id: 'FIG-1', schema: 'phdude.figure', name: 'bars', alt: '   ' },
      { id: 'FIG-2', schema: 'phdude.figure', name: 'lines', alt: 'It rises.' },
    ],
  });

  const action = recommendNext(snapshot, []).find((a) => a.rule === 'figure-missing-alt');
  assert.ok(action);
  assert.equal(action.impact, 'medium');
  assert.equal(action.dependents, 1);
  assert.match(action.why[0], /FIG-1 \(bars\)/);
  assert.doesNotMatch(action.why[0], /FIG-2/);
});

test('recommendNext: never-run covers what was declared and never produced, at low impact', () => {
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    repro: [
      reproItem('analysis', 'ANALYSIS-1', 'never-run', 'describe'),
      reproItem('figure', 'FIG-1', 'missing-output', 'bars'),
      reproItem('table', 'TABLE-1', 'up-to-date', 'means'),
    ],
  });

  const action = recommendNext(snapshot, []).find((a) => a.rule === 'never-run');
  assert.ok(action);
  assert.equal(action.impact, 'low');
  assert.equal(action.dependents, 2);
  assert.equal(action.command, 'phdude analyze run ANALYSIS-1');
  assert.match(action.why[1], /1 of them have never been run/);
  assert.match(action.why[2], /1 of them wrote an output that is no longer there/);
});

test('recommendNext: a workspace with nothing declared recommends none of the analysis rules', () => {
  const snapshot = emptySnapshot({ questions: [question('RQ-1')] });
  const rules = recommendNext(snapshot, []).map((a) => a.rule);
  for (const rule of ['analysis-stale', 'figure-missing-alt', 'never-run']) {
    assert.equal(rules.includes(rule), false, rule);
  }
});

test('recommendNext: analysis-stale names the whole sequence that clears a drifted input', () => {
  const current = 'b'.repeat(64);
  const snapshot = emptySnapshot({
    questions: [question('RQ-1')],
    executionEnabled: true,
    datasets: [{ id: 'DATASET-1', schema: 'phdude.dataset', path: 'data/survey.csv', hash: 'a' }],
    analyses: [
      {
        id: 'ANALYSIS-1',
        schema: 'phdude.analysis',
        name: 'describe',
        runtime: 'node',
        script: 'analysis/describe.mjs',
        args: ['--out', 'analysis/out/describe/results.json'],
        inputs: ['DATASET-1'],
        outputs: { results: 'analysis/out/describe/results.json', files: [] },
        params: {},
      },
    ],
    repro: [
      {
        kind: 'analysis',
        id: 'ANALYSIS-1',
        name: 'describe',
        status: 'stale',
        reasons: [{ kind: 'unregistered-input', input: 'DATASET-1', registered: 'a', current }],
      },
    ],
  });

  const action = recommendNext(snapshot, []).find((a) => a.rule === 'analysis-stale');
  const steps = action.command.split(', then ');
  assert.deepEqual(steps.slice(0, 1), ['phdude data add data/survey.csv']);
  assert.equal(steps.at(-1), 'phdude analyze run ANALYSIS-1');
  const declared = JSON.parse(steps[1].replace(/^phdude analyze add --json '/, '').slice(0, -1));
  assert.deepEqual(declared.inputs, [makeHashId('dataset', current)]);
  assert.equal(declared.name, 'describe');
  assert.equal(declared.script, 'analysis/describe.mjs');
  assert.deepEqual(declared.outputs, {
    results: 'analysis/out/describe/results.json',
    files: [],
  });
  assert.match(action.why.at(-1), /data\/survey\.csv is not the file DATASET-1 was registered/);
});

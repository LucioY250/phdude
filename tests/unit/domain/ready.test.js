import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MIN_HEALTH, REQUIREMENTS, ready, readyPolicy } from '../../../src/domain/ready.js';

const NOW = '2026-09-07T12:00:00Z';

function snapshot(overrides = {}) {
  return {
    questions: [],
    claims: [],
    evidence: [],
    sources: [],
    facts: [],
    decisions: [],
    methods: [],
    hypotheses: [],
    artifacts: [],
    results: [],
    figures: [],
    searches: [],
    reviews: [],
    citations: [],
    repro: [],
    sectionReports: [],
    sectionBodies: {},
    manuscript: null,
    now: NOW,
    staleAfterDays: 180,
    ...overrides,
  };
}

// A manuscript whose sections are all approved unless a status is given, so a test that is not
// about the manuscript does not have to describe one.
function manuscript(sections = [['introduction', 'approved']]) {
  return {
    title: 'A thesis',
    sections: sections.map(([id, status], index) => ({
      id,
      title: id,
      file: `manuscript/${id}.md`,
      order: index + 1,
      status,
      hash: null,
      claims: [],
      questions: [],
    })),
  };
}

function review(id, { kind = 'reviewer2', severity = 'major', status = 'open' } = {}) {
  return { id, kind, target: 'project', severity, status, message: `${id} says so`, evidence: [] };
}

function check(report, code) {
  const found = report.checks.find((entry) => entry.code === code);
  assert.ok(found, `no check ${code}: ${report.checks.map((c) => c.code).join(', ')}`);
  return found;
}

function blocking(report, code) {
  return report.blocking.find((item) => item.code === code) ?? null;
}

// A workspace with nothing in it fails on the manuscript alone: every other requirement is
// about something that is not there, and reporting an absence as a fault would be noise.
const EMPTY_BLOCKERS = ['all-sections-approved'];

test('ready runs every requirement the policy lists, in the canonical order', () => {
  const report = ready(snapshot(), null, {});

  const codes = report.checks.map((entry) => entry.code);
  for (const key of REQUIREMENTS) assert.ok(codes.includes(key), `no ${key} check`);
  assert.deepEqual(
    codes.filter((code) => REQUIREMENTS.includes(code)),
    REQUIREMENTS,
  );
  assert.deepEqual(codes.slice(-2), ['min-health', 'gaps-high']);
});

test('an empty workspace is not ready, and says the manuscript is why', () => {
  const report = ready(snapshot(), null, {});

  assert.equal(report.ready, false);
  assert.deepEqual(
    report.blocking.map((item) => item.code),
    EMPTY_BLOCKERS,
  );
  assert.match(blocking(report, 'all-sections-approved').message, /no manuscript/);
  assert.equal(blocking(report, 'all-sections-approved').command, 'phdude manuscript init');
});

test('a workspace with nothing wrong is ready', () => {
  const report = ready(snapshot({ manuscript: manuscript() }), null, {});

  assert.equal(report.ready, true);
  assert.deepEqual(report.blocking, []);
  assert.ok(report.checks.every((entry) => entry.ok));
});

test('every blocking item carries a code, a message and a command', () => {
  const report = ready(
    snapshot({
      manuscript: manuscript([['introduction', 'draft']]),
      figures: [{ id: 'FIG-1', name: 'f', alt: '' }],
      repro: [{ id: 'AN-1', status: 'stale' }],
      reviews: [review('REVIEW-1', { severity: 'block' })],
    }),
    null,
    {},
  );

  assert.ok(report.blocking.length >= 4);
  for (const item of report.blocking) {
    assert.equal(typeof item.code, 'string');
    assert.ok(item.message.length > 0, `${item.code} explains nothing`);
    assert.match(item.command, /^phdude /, `${item.code} suggests no command`);
    assert.deepEqual(Object.keys(item).sort(), ['code', 'command', 'message']);
  }
});

test('an open fact conflict blocks, with the command the gap report gives for it', () => {
  const facts = [
    { id: 'FACT-1', key: 'n', value: 312, from: { artifact: 'ART-1' }, state: 'candidate' },
    { id: 'FACT-2', key: 'n', value: 300, from: { artifact: 'ART-2' }, state: 'candidate' },
  ];
  const report = ready(snapshot({ manuscript: manuscript(), facts }), null, {});

  const item = blocking(report, 'no-open-conflicts');
  assert.ok(item, 'the conflict does not block');
  assert.match(item.message, /1 open fact conflict/);
  assert.match(item.message, /n\b/);
  assert.match(item.command, /^phdude decide propose --title "Resolve n"/);
  assert.equal(check(report, 'no-open-conflicts').severity, 'major');
});

test('a disputed claim pair blocks', () => {
  const claims = [
    {
      id: 'CLAIM-a',
      statement: 'a',
      kind: 'empirical',
      state: 'disputed',
      contradicts: ['CLAIM-b'],
    },
    {
      id: 'CLAIM-b',
      statement: 'b',
      kind: 'empirical',
      state: 'disputed',
      contradicts: ['CLAIM-a'],
    },
  ];
  const report = ready(snapshot({ manuscript: manuscript(), claims }), null, {});

  const item = blocking(report, 'no-disputed-pairs');
  assert.ok(item, 'the disputed pair does not block');
  assert.match(item.message, /1 disputed claim pair/);
  assert.match(item.command, /^phdude decide propose/);
});

test('an open block review blocks; an open major one does not, under full', () => {
  const withBlock = ready(
    snapshot({ manuscript: manuscript(), reviews: [review('REVIEW-1', { severity: 'block' })] }),
    null,
    {},
  );
  assert.match(blocking(withBlock, 'no-block-reviews').message, /REVIEW-1/);
  assert.equal(blocking(withBlock, 'no-block-reviews').command, 'phdude review show REVIEW-1');

  const withMajor = ready(
    snapshot({ manuscript: manuscript(), reviews: [review('REVIEW-2', { severity: 'major' })] }),
    null,
    {},
  );
  assert.equal(blocking(withMajor, 'no-block-reviews'), null);
  assert.equal(withMajor.ready, true);
});

test('ruthless promotes an open major review into a blocking one, without rewriting it', () => {
  const reviews = [review('REVIEW-2', { severity: 'major' })];
  const report = ready(snapshot({ manuscript: manuscript(), reviews }), null, {
    mode: 'ruthless',
  });

  assert.equal(report.ready, false);
  assert.match(blocking(report, 'no-block-reviews').message, /REVIEW-2/);
  assert.equal(reviews[0].severity, 'major', 'the stored severity was rewritten');
});

test('a closed review never blocks, whatever its severity', () => {
  for (const status of ['accepted', 'dismissed', 'resolved']) {
    const reviews = [review('REVIEW-1', { severity: 'block', status })];
    const report = ready(snapshot({ manuscript: manuscript(), reviews }), null, {});
    assert.equal(report.ready, true, `a ${status} review blocked`);
  }
});

test('a section that is not approved blocks, and names the sections', () => {
  const report = ready(
    snapshot({
      manuscript: manuscript([
        ['abstract', 'planned'],
        ['introduction', 'approved'],
        ['results', 'draft'],
      ]),
    }),
    null,
    {},
  );

  const item = blocking(report, 'all-sections-approved');
  assert.match(item.message, /2 of 3/);
  assert.match(item.message, /abstract, results/);
});

test('a figure without alt text blocks; a workspace with no figure does not', () => {
  const withFigure = ready(
    snapshot({
      manuscript: manuscript(),
      figures: [
        { id: 'FIG-1', name: 'one', alt: 'the finding' },
        { id: 'FIG-2', name: 'two', alt: '  ' },
      ],
    }),
    null,
    {},
  );
  assert.match(blocking(withFigure, 'figures-alt').message, /FIG-2/);
  assert.equal(blocking(withFigure, 'figures-alt').command, 'phdude figure check');

  const none = ready(snapshot({ manuscript: manuscript() }), null, {});
  assert.equal(check(none, 'figures-alt').ok, true);
});

test('an analysis, table or figure that is behind blocks', () => {
  const report = ready(
    snapshot({
      manuscript: manuscript(),
      repro: [
        { id: 'AN-1', status: 'up-to-date' },
        { id: 'TAB-1', status: 'stale' },
      ],
    }),
    null,
    {},
  );

  const item = blocking(report, 'repro-clean');
  assert.match(item.message, /TAB-1/);
  assert.equal(item.command, 'phdude repro check');
});

test('citations-clean reads the offline cite findings and the recorded citation reviews', () => {
  const withFinding = ready(
    snapshot({
      manuscript: manuscript(),
      citations: [
        { kind: 'uncited-source', id: 'SRC-1', message: 'SRC-1 is not cited by any evidence' },
        { kind: 'evidence-missing-source', id: 'EVID-1', message: 'EVID-1 cites nothing' },
      ],
    }),
    null,
    {},
  );
  const item = blocking(withFinding, 'citations-clean');
  assert.match(item.message, /EVID-1/);
  assert.doesNotMatch(item.message, /SRC-1/, 'an uncited source is not a citation fault');
  assert.equal(check(withFinding, 'citations-clean').severity, 'block');
  assert.equal(item.command, 'phdude audit citations');

  const withReview = ready(
    snapshot({
      manuscript: manuscript(),
      reviews: [review('REVIEW-c', { kind: 'citation', severity: 'major' })],
    }),
    null,
    {},
  );
  assert.match(blocking(withReview, 'citations-clean').message, /REVIEW-c/);
  assert.equal(check(withReview, 'citations-clean').severity, 'major');
});

test('a citation review at note or minor does not block under full', () => {
  const report = ready(
    snapshot({
      manuscript: manuscript(),
      reviews: [review('REVIEW-c', { kind: 'citation', severity: 'note' })],
    }),
    null,
    {},
  );
  assert.equal(report.ready, true);
});

test('health below the policy threshold blocks, and the threshold comes from the policy', () => {
  const claims = [{ id: 'CLAIM-1', statement: 'c', kind: 'empirical', state: 'candidate' }];
  const low = ready(snapshot({ manuscript: manuscript(), claims }), null, {});

  const item = blocking(low, 'min-health');
  assert.ok(item, 'a health of 0 did not block');
  assert.match(item.message, new RegExp(`${DEFAULT_MIN_HEALTH}`));
  assert.equal(item.command, 'phdude health');
  assert.equal(low.health.min, DEFAULT_MIN_HEALTH);

  const relaxed = ready(
    snapshot({ manuscript: manuscript(), claims }),
    { ready: { min_health: 0 } },
    {},
  );
  assert.equal(blocking(relaxed, 'min-health'), null);
  assert.equal(relaxed.health.min, 0);
});

test('a workspace that scores nothing at all has no health to check', () => {
  const report = ready(snapshot({ manuscript: manuscript() }), null, {});

  assert.equal(report.health.overall, null);
  assert.equal(check(report, 'min-health').ok, true);
  assert.match(check(report, 'min-health').message, /nothing/i);
});

test('a high-severity gap blocks, and points at the gap report', () => {
  const report = ready(
    snapshot({
      manuscript: manuscript(),
      questions: [{ id: 'RQ-1', text: 'why', state: 'canonical' }],
    }),
    null,
    {},
  );

  const item = blocking(report, 'gaps-high');
  assert.match(item.message, /RQ-1/);
  assert.equal(item.command, 'phdude gaps');
});

// The conflict and the disputed pair are `high` gaps too. Reporting them twice would tell the
// researcher to fix one thing in two places, so gaps-high leaves them to their own checks.
test('gaps-high leaves out what a required check already reports', () => {
  const facts = [
    { id: 'FACT-1', key: 'n', value: 312, from: { artifact: 'ART-1' }, state: 'candidate' },
    { id: 'FACT-2', key: 'n', value: 300, from: { artifact: 'ART-2' }, state: 'candidate' },
  ];
  const covered = ready(snapshot({ manuscript: manuscript(), facts }), null, {});
  assert.equal(blocking(covered, 'gaps-high'), null);

  const uncovered = ready(
    snapshot({ manuscript: manuscript(), facts }),
    { ready: { require: ['no-disputed-pairs'] } },
    {},
  );
  assert.match(blocking(uncovered, 'gaps-high').message, /open-conflict/);
});

test('the policy chooses which requirements run', () => {
  const state = snapshot({
    manuscript: manuscript([['introduction', 'draft']]),
    reviews: [review('REVIEW-1', { severity: 'block' })],
  });
  const report = ready(state, { ready: { require: ['no-block-reviews'] } }, {});

  const codes = report.checks.map((entry) => entry.code);
  assert.ok(codes.includes('no-block-reviews'));
  assert.ok(!codes.includes('all-sections-approved'), 'a requirement the policy dropped still ran');
  assert.deepEqual(
    report.blocking.map((item) => item.code),
    ['no-block-reviews'],
  );
});

test('a requirement the policy invents is reported rather than silently ignored', () => {
  const report = ready(
    snapshot({ manuscript: manuscript() }),
    { ready: { require: ['no-block-reviews', 'no-bad-vibes'] } },
    {},
  );

  assert.ok(report.warnings.includes('unknown requirement in ready.require: no-bad-vibes'));
  assert.equal(report.ready, true);
});

test('an unusable min_health falls back to the default rather than poisoning the verdict', () => {
  for (const value of ['70', -1, 101, null, {}]) {
    const report = ready(
      snapshot({ manuscript: manuscript() }),
      { ready: { min_health: value } },
      {},
    );
    assert.equal(report.health.min, DEFAULT_MIN_HEALTH, `min_health ${JSON.stringify(value)}`);
  }
});

test('lite reports only what blocks, and says what it set aside', () => {
  const state = snapshot({
    manuscript: manuscript([['introduction', 'draft']]),
    repro: [{ id: 'AN-1', status: 'stale' }],
  });

  // The stale analysis drags Research Health down too; the threshold is taken out of the way
  // so this reads the mode and nothing else.
  const policy = { ready: { min_health: 0 } };

  const full = ready(state, policy, {});
  assert.deepEqual(full.blocking.map((item) => item.code).sort(), [
    'all-sections-approved',
    'repro-clean',
  ]);
  assert.deepEqual(full.relaxed, []);

  const lite = ready(state, policy, { mode: 'lite' });
  assert.deepEqual(
    lite.blocking.map((item) => item.code),
    ['all-sections-approved'],
  );
  assert.deepEqual(
    lite.relaxed.map((item) => item.code),
    ['repro-clean'],
  );
  assert.equal(lite.ready, false);
});

test('lite can be ready while a major finding stands, and never hides it', () => {
  const state = snapshot({ manuscript: manuscript(), repro: [{ id: 'AN-1', status: 'stale' }] });
  const policy = { ready: { min_health: 0 } };

  assert.equal(ready(state, policy, {}).ready, false);
  const lite = ready(state, policy, { mode: 'lite' });
  assert.equal(lite.ready, true);
  assert.deepEqual(
    lite.relaxed.map((item) => item.code),
    ['repro-clean'],
  );
});

test('off runs the full set, like full: the researcher asked for the verdict', () => {
  const state = snapshot({ manuscript: manuscript(), repro: [{ id: 'AN-1', status: 'stale' }] });

  assert.equal(ready(state, null, { mode: 'off' }).ready, false);
  assert.deepEqual(ready(state, null, { mode: 'off' }).blocking, ready(state, null, {}).blocking);
});

test('a venue that blocks the manuscript blocks the verdict, one item per rule', () => {
  const profile = {
    name: 'ieee',
    display: 'IEEE',
    document_class: 'IEEEtran',
    sections: [
      { id: 'introduction', order: 1 },
      { id: 'results', order: 2 },
    ],
  };
  const report = ready(snapshot({ manuscript: manuscript() }), null, { profile });

  const item = blocking(report, 'profile-section-missing');
  assert.ok(item, 'the missing venue section did not block');
  assert.match(item.message, /results/);
  assert.equal(item.command, 'phdude profile check --profile ieee');
  assert.equal(report.profile, 'ieee');
});

test('a venue with nothing blocking records that it was checked', () => {
  const profile = {
    name: 'ieee',
    display: 'IEEE',
    document_class: 'IEEEtran',
    sections: [{ id: 'introduction', order: 1 }],
  };
  const report = ready(snapshot({ manuscript: manuscript() }), null, { profile });

  assert.equal(check(report, 'profile-check').ok, true);
  assert.match(check(report, 'profile-check').message, /ieee/);
  assert.equal(report.ready, true);
});

test('no venue at all is a warning, never a silent pass', () => {
  const report = ready(snapshot({ manuscript: manuscript() }), null, {});

  assert.equal(report.profile, null);
  assert.equal(
    report.checks.some((entry) => entry.code.startsWith('profile')),
    false,
  );
  assert.deepEqual(report.warnings, [
    'no venue profile is targeted, so the venue rules were not checked',
  ]);
});

test('a section under a venue word limit is measured on the prose, not the file', () => {
  const profile = {
    name: 'ieee',
    display: 'IEEE',
    document_class: 'IEEEtran',
    sections: [{ id: 'introduction', order: 1, max_words: 3 }],
  };
  const state = snapshot({
    manuscript: manuscript(),
    sectionBodies: {
      introduction: '---\nsection: introduction\n---\n\nOne two three four five six.\n',
    },
  });

  const report = ready(state, null, { profile });
  assert.ok(
    report.blocking.some((item) => item.code.startsWith('profile-')),
    'the over-limit section did not block',
  );
});

test('readyPolicy defaults the whole block when the policy has none', () => {
  assert.deepEqual(readyPolicy(null), { minHealth: DEFAULT_MIN_HEALTH, require: REQUIREMENTS });
  assert.deepEqual(readyPolicy({}), { minHealth: DEFAULT_MIN_HEALTH, require: REQUIREMENTS });
  assert.deepEqual(readyPolicy({ ready: { require: [] } }), {
    minHealth: DEFAULT_MIN_HEALTH,
    require: [],
  });
});

test('ready never mutates the snapshot it reads', () => {
  const state = snapshot({
    manuscript: manuscript(),
    reviews: [review('REVIEW-1', { severity: 'major' })],
    repro: [{ id: 'AN-1', status: 'stale' }],
  });
  const before = JSON.stringify(state);

  ready(state, null, { mode: 'ruthless' });
  assert.equal(JSON.stringify(state), before);
});

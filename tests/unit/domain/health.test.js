import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WEIGHTS, DIMENSIONS, health } from '../../../src/domain/health.js';

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
    searches: [],
    reviews: [],
    citations: [],
    repro: [],
    sectionReports: [],
    manuscript: null,
    now: NOW,
    staleAfterDays: 180,
    ...overrides,
  };
}

function question(id) {
  return { id, text: `question ${id}`, state: 'canonical' };
}

function claim(id, state, { questions = [], supported_by = [], contradicts = [] } = {}) {
  return { id, statement: id, kind: 'empirical', state, questions, supported_by, contradicts };
}

function evidence(id, strength, source = 'SRC-0000000001') {
  return { id, source, excerpt: id, strength, state: 'candidate' };
}

function search(question, lastRun) {
  return {
    id: `SEARCH-${question}`,
    query: 'q',
    question,
    providers: [],
    runs: [],
    last_run: lastRun,
  };
}

// The six sub-scores a stored section report carries; the aggregate is derived from them.
function proseScores(value) {
  return {
    specificity: value,
    evidenceAlignment: value,
    epistemicPrecision: value,
    structuralVariation: value,
    authorVoice: value,
    conciseness: value,
  };
}

function dimension(report, key) {
  const found = report.dimensions.find((d) => d.key === key);
  assert.ok(found, `no dimension ${key}`);
  return found;
}

test('health reports the eight dimensions of spec §3.3, in a fixed order', () => {
  const report = health(snapshot(), null);

  assert.deepEqual(
    report.dimensions.map((d) => d.key),
    DIMENSIONS.map(([key]) => key),
  );
  assert.deepEqual(
    report.dimensions.map((d) => d.label),
    DIMENSIONS.map(([, label]) => label),
  );
  assert.equal(report.dimensions.length, 8);
});

test('health: an empty workspace scores nothing rather than a hundred', () => {
  const report = health(snapshot(), null);

  for (const d of report.dimensions) assert.equal(d.score, null, `${d.key} invented a score`);
  assert.equal(report.overall, null);
});

test('health: every score is null or within 0-100', () => {
  const report = health(
    snapshot({
      questions: [question('RQ-1'), question('RQ-2')],
      claims: [
        claim('CLAIM-1', 'canonical', { questions: ['RQ-1'], supported_by: ['EVID-1'] }),
        claim('CLAIM-2', 'rejected', { questions: ['RQ-2'] }),
      ],
      evidence: [evidence('EVID-1', 'strong')],
      sources: [
        { id: 'SRC-0000000001', title: 't', authors: ['a'], type: 'article', state: 'canonical' },
      ],
      citations: Array.from({ length: 40 }, (_, i) => ({ kind: 'missing-field', id: `SRC-${i}` })),
      facts: [],
      repro: [{ kind: 'analysis', id: 'ANALYSIS-1', status: 'stale', reasons: [] }],
    }),
    null,
  );

  for (const d of report.dimensions) {
    if (d.score === null) continue;
    assert.ok(d.score >= 0 && d.score <= 100, `${d.key} out of bounds: ${d.score}`);
    assert.equal(Number.isInteger(d.score), true, `${d.key} is not an integer`);
  }
});

test('Literature Coverage is the mean of answered, sourced and fresh questions', () => {
  const report = health(
    snapshot({
      questions: [question('RQ-1'), question('RQ-2')],
      claims: [
        claim('CLAIM-1', 'supported', { questions: ['RQ-1'], supported_by: ['EVID-1'] }),
        claim('CLAIM-2', 'candidate', { questions: ['RQ-2'] }),
      ],
      evidence: [evidence('EVID-1', 'moderate')],
      searches: [search('RQ-1', NOW), search('RQ-2', NOW)],
    }),
    null,
  );

  // 50% answered, 50% sourced, 0% stale -> mean(50, 50, 100)
  assert.equal(dimension(report, 'literature-coverage').score, 67);
});

test('Literature Coverage names the questions behind each component', () => {
  const report = health(
    snapshot({
      questions: [question('RQ-1'), question('RQ-2')],
      claims: [claim('CLAIM-1', 'supported', { questions: ['RQ-1'], supported_by: ['EVID-1'] })],
      evidence: [evidence('EVID-1', 'strong')],
      searches: [search('RQ-1', NOW)],
    }),
    null,
  );

  const ids = dimension(report, 'literature-coverage').observations.flatMap((o) => o.ids ?? []);
  assert.ok(ids.includes('RQ-2'), 'the unanswered question is never named');
});

test('Literature Coverage is null when no research question is recorded', () => {
  const report = health(snapshot({ claims: [claim('CLAIM-1', 'canonical')] }), null);
  assert.equal(dimension(report, 'literature-coverage').score, null);
});

test('Evidence Strength is the claim-state mean times the evidence strength factor', () => {
  const report = health(
    snapshot({
      claims: [
        claim('CLAIM-1', 'canonical', { supported_by: ['EVID-1'] }),
        claim('CLAIM-2', 'candidate', { supported_by: ['EVID-2'] }),
      ],
      evidence: [evidence('EVID-1', 'strong'), evidence('EVID-2', 'weak')],
    }),
    null,
  );

  // mean(100, 40) = 70; factor mean(1, 0.5) = 0.75
  assert.equal(dimension(report, 'evidence-strength').score, 53);
});

test('Evidence Strength is zero when claims are recorded and no evidence is', () => {
  const report = health(snapshot({ claims: [claim('CLAIM-1', 'canonical')] }), null);
  assert.equal(dimension(report, 'evidence-strength').score, 0);
});

test('Evidence Strength is null when no claim is recorded', () => {
  const report = health(snapshot({ evidence: [evidence('EVID-1', 'strong')] }), null);
  assert.equal(dimension(report, 'evidence-strength').score, null);
});

test('Methodological Integrity averages method coverage and declared limitations', () => {
  const report = health(
    snapshot({
      questions: [question('RQ-1'), question('RQ-2')],
      methods: [
        {
          id: 'METH-1',
          name: 'm',
          design: 'd',
          paradigm: 'mixed',
          questions: ['RQ-1'],
          state: 'canonical',
          limitations: ['small n'],
        },
        {
          id: 'METH-2',
          name: 'm2',
          design: 'd',
          paradigm: 'mixed',
          questions: [],
          state: 'canonical',
        },
      ],
    }),
    null,
  );

  // 50% of questions have a method, 50% of methods declare limitations
  assert.equal(dimension(report, 'methodological-integrity').score, 50);
});

test('Methodological Integrity loses 20 per open methodology review, and floors at 0', () => {
  const base = {
    questions: [question('RQ-1')],
    methods: [
      {
        id: 'METH-1',
        name: 'm',
        design: 'd',
        paradigm: 'mixed',
        questions: ['RQ-1'],
        state: 'canonical',
        limitations: ['small n'],
      },
    ],
  };
  const review = (id, status) => ({
    id,
    kind: 'methodology',
    target: 'METH-1',
    severity: 'major',
    message: 'sampling is not described',
    status,
  });

  const one = health(snapshot({ ...base, reviews: [review('REVIEW-1', 'open')] }), null);
  assert.equal(dimension(one, 'methodological-integrity').score, 80);

  const resolved = health(snapshot({ ...base, reviews: [review('REVIEW-1', 'resolved')] }), null);
  assert.equal(dimension(resolved, 'methodological-integrity').score, 100);

  const many = health(
    snapshot({
      ...base,
      reviews: Array.from({ length: 9 }, (_, i) => review(`REVIEW-${i}`, 'open')),
    }),
    null,
  );
  assert.equal(dimension(many, 'methodological-integrity').score, 0);
});

test('Methodological Integrity is null when neither a question nor a method is recorded', () => {
  const report = health(snapshot(), null);
  assert.equal(dimension(report, 'methodological-integrity').score, null);
});

test('Citation Quality loses 10 per citation finding and per open citation review', () => {
  const sources = [
    { id: 'SRC-0000000001', title: 't', authors: ['a'], type: 'article', state: 'canonical' },
  ];
  const report = health(
    snapshot({
      sources,
      citations: [
        { kind: 'invalid-doi', id: 'SRC-0000000001', message: 'bad doi' },
        { kind: 'missing-field', id: 'SRC-0000000001', message: 'missing year' },
      ],
      reviews: [
        {
          id: 'REVIEW-c',
          kind: 'citation',
          target: 'SRC-0000000001',
          severity: 'major',
          message: 'title mismatch',
          status: 'open',
        },
      ],
    }),
    null,
  );

  assert.equal(dimension(report, 'citation-quality').score, 70);
});

// `phdude audit citations` records an uncited source as a `citation` review at `note`. Charging
// that would mean running the auditor costs a workspace ten points for the one finding
// `cite check` calls informational, and the two paths would disagree about the same source.
test('Citation Quality never charges for a citation review recorded as a note', () => {
  const report = health(
    snapshot({
      sources: [
        { id: 'SRC-0000000001', title: 't', authors: ['a'], type: 'article', state: 'canonical' },
      ],
      reviews: [
        {
          id: 'REVIEW-n',
          kind: 'citation',
          target: 'SRC-0000000001',
          severity: 'note',
          message: 'SRC-0000000001 is not cited by any evidence',
          status: 'open',
        },
      ],
    }),
    null,
  );

  const quality = dimension(report, 'citation-quality');
  assert.equal(quality.score, 100);
  assert.ok(
    quality.observations.some((o) => (o.ids ?? []).includes('REVIEW-n')),
    'the note is not reported at all',
  );
});

test('Citation Quality never charges for an uncited source, which cite check calls informational', () => {
  const report = health(
    snapshot({
      sources: [
        { id: 'SRC-0000000001', title: 't', authors: ['a'], type: 'article', state: 'canonical' },
      ],
      citations: [{ kind: 'uncited-source', id: 'SRC-0000000001', message: 'not cited' }],
    }),
    null,
  );

  const cited = dimension(report, 'citation-quality');
  assert.equal(cited.score, 100);
  assert.ok(
    cited.observations.some((o) => (o.ids ?? []).includes('SRC-0000000001')),
    'the uncited source is not reported at all',
  );
});

test('Citation Quality is null when the workspace records no source', () => {
  assert.equal(dimension(health(snapshot(), null), 'citation-quality').score, null);
});

test('Freshness is 100 minus the share of questions whose search has gone stale', () => {
  const stale = '2020-01-01T00:00:00Z';
  const report = health(
    snapshot({
      questions: [question('RQ-1'), question('RQ-2'), question('RQ-3'), question('RQ-4')],
      searches: [search('RQ-1', NOW), search('RQ-2', NOW), search('RQ-3', stale)],
    }),
    null,
  );

  // RQ-3 is stale and RQ-4 was never searched: 2 of 4
  assert.equal(dimension(report, 'freshness').score, 50);
});

test('Freshness is null when no research question is recorded', () => {
  assert.equal(dimension(health(snapshot(), null), 'freshness').score, null);
});

test('Reproducibility is the up-to-date share of what the workspace declares', () => {
  const report = health(
    snapshot({
      repro: [
        { kind: 'analysis', id: 'ANALYSIS-1', name: 'a', status: 'up-to-date', reasons: [] },
        { kind: 'table', id: 'TABLE-1', name: 't', status: 'stale', reasons: [] },
        { kind: 'figure', id: 'FIG-1', name: 'f', status: 'never-run', reasons: [] },
        { kind: 'figure', id: 'FIG-2', name: 'f2', status: 'up-to-date', reasons: [] },
      ],
    }),
    null,
  );

  assert.equal(dimension(report, 'reproducibility').score, 50);
});

test('Reproducibility is null when nothing reproducible is declared, so it cannot inflate', () => {
  assert.equal(dimension(health(snapshot(), null), 'reproducibility').score, null);
});

test('Consistency loses 25 per open conflict and per disputed pair, and floors at 0', () => {
  const facts = (value, artifact) => ({
    id: `FACT-${artifact}`,
    key: 'sample.size',
    value,
    from: { artifact },
    state: 'candidate',
  });

  const report = health(
    snapshot({
      facts: [facts(30, 'ART-a'), facts(40, 'ART-b')],
      claims: [
        claim('CLAIM-1', 'disputed', { contradicts: ['CLAIM-2'] }),
        claim('CLAIM-2', 'disputed', { contradicts: ['CLAIM-1'] }),
      ],
      evidence: [evidence('EVID-1', 'strong')],
    }),
    null,
  );

  assert.equal(dimension(report, 'consistency').score, 50);

  // Five more disputed pairs is 150 points off a 100-point scale: the floor, not a negative.
  const pairs = [];
  for (let i = 0; i < 10; i += 2) {
    pairs.push(claim(`CLAIM-p${i}`, 'disputed', { contradicts: [`CLAIM-p${i + 1}`] }));
    pairs.push(claim(`CLAIM-p${i + 1}`, 'disputed', { contradicts: [`CLAIM-p${i}`] }));
  }
  const floored = health(
    snapshot({
      facts: [facts(30, 'ART-a'), facts(40, 'ART-b')],
      claims: pairs,
      evidence: [evidence('EVID-1', 'strong')],
    }),
    null,
  );

  assert.equal(dimension(floored, 'consistency').score, 0);
});

test('Consistency is 100 with nothing contested, and null with nothing to contest', () => {
  const clean = health(
    snapshot({ claims: [claim('CLAIM-1', 'canonical')], evidence: [evidence('EVID-1', 'strong')] }),
    null,
  );
  assert.equal(dimension(clean, 'consistency').score, 100);
  assert.equal(dimension(health(snapshot(), null), 'consistency').score, null);
});

test('Academic Prose Quality is the mean of the section report aggregates', () => {
  const report = health(
    snapshot({
      manuscript: { title: 'T', sections: [] },
      sectionReports: [
        { section: 'introduction', scores: proseScores(80) },
        { section: 'methods', scores: proseScores(60) },
      ],
    }),
    null,
  );

  assert.equal(dimension(report, 'prose-quality').score, 70);
});

test('Academic Prose Quality is null without a manuscript, and without a report', () => {
  assert.equal(dimension(health(snapshot(), null), 'prose-quality').score, null);

  const planned = health(snapshot({ manuscript: { title: 'T', sections: [] } }), null);
  assert.equal(dimension(planned, 'prose-quality').score, null);
});

test('the overall is the weighted mean over the dimensions that scored', () => {
  const report = health(
    snapshot({
      repro: [
        { kind: 'analysis', id: 'ANALYSIS-1', name: 'a', status: 'up-to-date', reasons: [] },
        { kind: 'table', id: 'TABLE-1', name: 't', status: 'stale', reasons: [] },
      ],
      claims: [claim('CLAIM-1', 'canonical', { supported_by: ['EVID-1'] })],
      evidence: [evidence('EVID-1', 'strong')],
    }),
    null,
  );

  const scored = report.dimensions.filter((d) => d.score !== null);
  const expected = Math.round(
    scored.reduce((sum, d) => sum + d.score * d.weight, 0) /
      scored.reduce((sum, d) => sum + d.weight, 0),
  );
  assert.equal(report.overall, expected);
});

test('the weights come from policy.health.weights, defaulting to one each', () => {
  // Only two dimensions score here: Citation Quality (100, one clean source) and
  // Reproducibility (0, one stale table). Everything else is null, so the mean is theirs.
  const input = snapshot({
    sources: [
      { id: 'SRC-0000000001', title: 't', authors: ['a'], type: 'article', state: 'canonical' },
    ],
    repro: [{ kind: 'table', id: 'TABLE-1', name: 't', status: 'stale', reasons: [] }],
  });

  const flat = health(input, null);
  assert.deepEqual(flat.weights, DEFAULT_WEIGHTS);
  assert.equal(flat.overall, 50);

  const weighted = health(input, {
    health: { weights: { 'citation-quality': 3, reproducibility: 1 } },
  });
  assert.equal(weighted.weights['citation-quality'], 3);
  assert.equal(dimension(weighted, 'citation-quality').weight, 3);
  assert.equal(weighted.overall, 75);
});

test('an unusable weight falls back to one rather than poisoning the mean', () => {
  const report = health(snapshot(), {
    health: { weights: { 'evidence-strength': -2, freshness: 'heavy', consistency: null } },
  });

  assert.equal(report.weights['evidence-strength'], 1);
  assert.equal(report.weights.freshness, 1);
  assert.equal(report.weights.consistency, 1);
});

test('a dimension weighted to zero is left out of the overall', () => {
  const input = snapshot({
    claims: [claim('CLAIM-1', 'candidate', { supported_by: ['EVID-1'] })],
    evidence: [evidence('EVID-1', 'weak')],
    repro: [{ kind: 'table', id: 'TABLE-1', name: 't', status: 'up-to-date', reasons: [] }],
  });

  const report = health(input, { health: { weights: { 'evidence-strength': 0 } } });
  assert.equal(report.overall, 100);
});

test('health reads a workspace with no reviews and no citation findings at all', () => {
  const bare = {
    questions: [question('RQ-1')],
    claims: [],
    evidence: [],
    now: NOW,
    staleAfterDays: 180,
  };

  const report = health(bare, undefined);
  assert.equal(report.dimensions.length, 8);
  assert.equal(dimension(report, 'freshness').score, 0);
});

test('every dimension carries at least one observation explaining its number', () => {
  const report = health(
    snapshot({
      questions: [question('RQ-1')],
      claims: [claim('CLAIM-1', 'canonical', { questions: ['RQ-1'], supported_by: ['EVID-1'] })],
      evidence: [evidence('EVID-1', 'strong')],
      sources: [
        { id: 'SRC-0000000001', title: 't', authors: ['a'], type: 'article', state: 'canonical' },
      ],
      searches: [search('RQ-1', NOW)],
      repro: [{ kind: 'table', id: 'TABLE-1', name: 't', status: 'up-to-date', reasons: [] }],
      manuscript: { title: 'T', sections: [] },
      sectionReports: [{ section: 'introduction', scores: proseScores(80) }],
    }),
    null,
  );

  for (const d of report.dimensions) {
    assert.ok(d.observations.length > 0, `${d.key} explains nothing`);
    for (const o of d.observations) assert.equal(typeof o.message, 'string');
  }
});

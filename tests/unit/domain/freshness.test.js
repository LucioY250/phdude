import test from 'node:test';
import assert from 'node:assert/strict';
import {
  questionFreshness,
  sourceAges,
  staleSearches,
  summary,
} from '../../../src/domain/freshness.js';

const NOW = '2026-09-07T12:00:00Z';

function question(id) {
  return { id, schema: 'phdude.question', text: `text of ${id}` };
}

function search(id, questionId, lastRun) {
  return { id, schema: 'phdude.search', question: questionId, last_run: lastRun };
}

test('questionFreshness: a question that was never searched is stale with no date', () => {
  const rows = questionFreshness([question('RQ-1')], [], NOW, 180);

  assert.deepEqual(rows, [
    { question: 'RQ-1', lastSearch: null, daysAgo: null, stale: true, searches: 0 },
  ]);
});

test('questionFreshness: a recent search is not stale and reports whole days', () => {
  const searches = [search('SEARCH-1', 'RQ-1', '2026-09-01T12:00:00Z')];

  const [row] = questionFreshness([question('RQ-1')], searches, NOW, 180);

  assert.equal(row.lastSearch, '2026-09-01T12:00:00Z');
  assert.equal(row.daysAgo, 6);
  assert.equal(row.stale, false);
  assert.equal(row.searches, 1);
});

test('questionFreshness: the newest run of several searches decides the age', () => {
  const searches = [
    search('SEARCH-1', 'RQ-1', '2025-01-01T00:00:00Z'),
    search('SEARCH-2', 'RQ-1', '2026-09-05T12:00:00Z'),
    search('SEARCH-3', 'RQ-2', '2026-09-06T12:00:00Z'),
  ];

  const [row] = questionFreshness([question('RQ-1')], searches, NOW, 180);

  assert.equal(row.lastSearch, '2026-09-05T12:00:00Z');
  assert.equal(row.daysAgo, 2);
  assert.equal(row.searches, 2, 'only the searches for this question count');
});

test('questionFreshness: the threshold day itself is already stale', () => {
  const at = new Date(Date.parse(NOW) - 180 * 86400000).toISOString();
  const before = new Date(Date.parse(NOW) - 179 * 86400000).toISOString();

  const [stale] = questionFreshness([question('RQ-1')], [search('S', 'RQ-1', at)], NOW, 180);
  const [fresh] = questionFreshness([question('RQ-1')], [search('S', 'RQ-1', before)], NOW, 180);

  assert.equal(stale.daysAgo, 180);
  assert.equal(stale.stale, true);
  assert.equal(fresh.daysAgo, 179);
  assert.equal(fresh.stale, false);
});

test('questionFreshness: a search with no question counts for nobody', () => {
  const rows = questionFreshness(
    [question('RQ-1')],
    [search('SEARCH-1', null, '2026-09-06T12:00:00Z')],
    NOW,
    180,
  );

  assert.equal(rows[0].searches, 0);
  assert.equal(rows[0].stale, true);
});

test('questionFreshness: an unparseable or missing last_run does not count as a search', () => {
  const rows = questionFreshness(
    [question('RQ-1')],
    [search('SEARCH-1', 'RQ-1', 'not a date'), { id: 'SEARCH-2', question: 'RQ-1' }],
    NOW,
    180,
  );

  assert.deepEqual(rows, [
    { question: 'RQ-1', lastSearch: null, daysAgo: null, stale: true, searches: 0 },
  ]);
});

test('questionFreshness: rows keep the order the questions came in', () => {
  const rows = questionFreshness([question('RQ-2'), question('RQ-1')], [], NOW, 180);
  assert.deepEqual(
    rows.map((r) => r.question),
    ['RQ-2', 'RQ-1'],
  );
});

test('sourceAges: age is the years between the source year and now', () => {
  const rows = sourceAges(
    [{ id: 'SRC-1', year: 2020 }, { id: 'SRC-2', year: 2026 }, { id: 'SRC-3' }],
    NOW,
  );

  assert.deepEqual(rows, [
    { id: 'SRC-1', year: 2020, age: 6 },
    { id: 'SRC-2', year: 2026, age: 0 },
    { id: 'SRC-3', year: null, age: null },
  ]);
});

test('summary: counts questions, staleness and source ages', () => {
  const questions = [
    { question: 'RQ-1', lastSearch: null, daysAgo: null, stale: true, searches: 0 },
    {
      question: 'RQ-2',
      lastSearch: '2025-01-01T00:00:00Z',
      daysAgo: 614,
      stale: true,
      searches: 1,
    },
    { question: 'RQ-3', lastSearch: '2026-09-01T00:00:00Z', daysAgo: 6, stale: false, searches: 2 },
  ];
  const sources = [
    { id: 'SRC-1', year: 2020, age: 6 },
    { id: 'SRC-2', year: 2024, age: 2 },
    { id: 'SRC-3', year: null, age: null },
  ];

  assert.deepEqual(summary(questions, sources, [{}, {}, {}, {}]), {
    questions: 3,
    stale: 2,
    neverSearched: 1,
    searches: 4,
    sources: 3,
    medianAge: 4,
    oldest: 6,
  });
});

test('summary: no sources with a year leaves the ages null', () => {
  assert.deepEqual(summary([], [{ id: 'SRC-1', year: null, age: null }], []), {
    questions: 0,
    stale: 0,
    neverSearched: 0,
    searches: 0,
    sources: 1,
    medianAge: null,
    oldest: null,
  });
});

test('staleSearches: a search past the threshold is due, one inside it is not', () => {
  const due = search('SEARCH-1', 'RQ-1', '2026-01-01T12:00:00Z');
  const recent = search('SEARCH-2', 'RQ-1', '2026-09-01T12:00:00Z');

  assert.deepEqual(staleSearches([due, recent], NOW, 180), [due]);
});

test('staleSearches: the threshold day itself is already due', () => {
  const at = new Date(Date.parse(NOW) - 180 * 86400000).toISOString();
  const before = new Date(Date.parse(NOW) - 179 * 86400000).toISOString();

  assert.equal(staleSearches([search('S', 'RQ-1', at)], NOW, 180).length, 1);
  assert.equal(staleSearches([search('S', 'RQ-1', before)], NOW, 180).length, 0);
});

test('staleSearches: a search with no readable last_run is due', () => {
  const searches = [search('SEARCH-1', 'RQ-1', 'not a date'), { id: 'SEARCH-2' }];
  assert.equal(staleSearches(searches, NOW, 180).length, 2);
});

test('staleSearches: a search tied to no question is still due on age alone', () => {
  const due = search('SEARCH-1', null, '2025-01-01T00:00:00Z');
  assert.deepEqual(staleSearches([due], NOW, 180), [due]);
});

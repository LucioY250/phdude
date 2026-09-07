import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFilters, dedupe, score } from '../../../src/domain/candidates.js';

function candidate(overrides = {}) {
  return {
    provider: 'openalex',
    external_id: 'W1',
    title: 'Leakage and the reproducibility crisis',
    authors: ['A. Kapoor'],
    year: 2023,
    venue: 'Patterns',
    doi: '10.1016/j.patter.2023.100804',
    url: 'https://doi.org/10.1016/j.patter.2023.100804',
    abstract: null,
    type: 'article',
    open_access: true,
    cited_by: 945,
    ...overrides,
  };
}

test('dedupe keeps a single candidate and records the providers that returned it', () => {
  const a = candidate();
  const b = candidate({ provider: 'crossref', external_id: '10.1016/J.PATTER.2023.100804' });

  const result = dedupe([a, b]);

  assert.equal(result.length, 1);
  assert.equal(result[0].provider, 'openalex', 'the first provider stays the owner');
  assert.equal(result[0].external_id, 'W1', "the first provider's id stays the external id");
  assert.deepEqual(result[0].providers, ['openalex', 'crossref']);
  assert.deepEqual(result[0].ext, { ids: { crossref: '10.1016/J.PATTER.2023.100804' } });
});

test('dedupe matches on the DOI case-insensitively and ignores the resolver prefix', () => {
  const a = candidate({ doi: '10.1234/ABC' });
  const b = candidate({
    provider: 'crossref',
    external_id: 'x',
    doi: 'https://doi.org/10.1234/abc',
  });

  assert.equal(dedupe([a, b]).length, 1);
});

test('dedupe matches on normalized title plus year when neither side has a DOI', () => {
  const a = candidate({ doi: null, title: 'Open   Science  Reproducibility' });
  const b = candidate({
    provider: 'arxiv',
    external_id: '2101.00001',
    doi: null,
    title: 'open science reproducibility',
  });

  const result = dedupe([a, b]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].providers, ['openalex', 'arxiv']);
});

test('dedupe keeps two works that share a title but not a year', () => {
  const a = candidate({ doi: null, year: 2021 });
  const b = candidate({ provider: 'arxiv', external_id: '2', doi: null, year: 2023 });

  assert.equal(dedupe([a, b]).length, 2);
});

test('dedupe keeps two works that share neither a DOI nor a title', () => {
  const a = candidate({ doi: '10.1234/a', title: 'One study' });
  const b = candidate({
    provider: 'crossref',
    external_id: 'b',
    doi: '10.1234/b',
    title: 'Another study',
  });

  assert.equal(dedupe([a, b]).length, 2);
});

test('dedupe merges a work one provider has a DOI for and another does not', () => {
  // OpenAlex returns the preprint without a DOI; Crossref returns the same work with one. The
  // title and the year still match, which spec §3.3 treats as the same work.
  const withoutDoi = candidate({
    doi: null,
    title: 'A Preprint on Reproducible Pipelines',
    year: 2023,
  });
  const withDoi = candidate({
    provider: 'crossref',
    external_id: '10.31224/7150',
    doi: '10.31224/7150',
    title: 'A Preprint on Reproducible Pipelines',
    year: 2023,
  });

  const result = dedupe([withoutDoi, withDoi]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].providers, ['openalex', 'crossref']);
  assert.equal(result[0].doi, null, "the first provider's fields are kept as they were");
});

test('dedupe merges a preprint and its published version when title and year agree', () => {
  const preprint = candidate({ doi: '10.31224/7150', type: 'preprint' });
  const published = candidate({ provider: 'crossref', external_id: 'p', doi: '10.1234/published' });

  assert.equal(dedupe([preprint, published]).length, 1);
});

test('dedupe ignores a second hit from a provider already merged into the group', () => {
  const a = candidate();
  const again = candidate({ external_id: 'W2' });

  const result = dedupe([a, again]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].providers, ['openalex']);
  assert.equal(result[0].ext, undefined);
});

test('dedupe leaves a lone candidate with a one-entry providers list and no ext', () => {
  const [only] = dedupe([candidate()]);
  assert.deepEqual(only.providers, ['openalex']);
  assert.equal(only.ext, undefined);
});

test('dedupe does not mutate its input', () => {
  const a = candidate();
  const b = candidate({ provider: 'crossref', external_id: 'x' });
  dedupe([a, b]);
  assert.equal(a.providers, undefined);
  assert.equal(a.ext, undefined);
});

test('applyFilters drops candidates published before year_range.from', () => {
  const kept = candidate({ year: 2023 });
  const dropped = candidate({ provider: 'crossref', external_id: 'old', year: 2019 });

  const result = applyFilters([kept, dropped], { from: 2021 });
  assert.deepEqual(
    result.map((c) => c.year),
    [2023],
  );
});

test('applyFilters keeps a candidate whose year is unknown', () => {
  const result = applyFilters([candidate({ year: null })], { from: 2021 });
  assert.equal(result.length, 1);
});

test('applyFilters is a no-op on languages because no provider reports one', () => {
  const result = applyFilters([candidate()], { from: null, languages: ['fr'] });
  assert.equal(result.length, 1, 'a candidate without a lang field is never dropped');
});

test('applyFilters drops a candidate whose reported language is not allowed', () => {
  const spanish = { ...candidate(), lang: 'es' };
  const english = { ...candidate({ provider: 'crossref', external_id: 'en' }), lang: 'en' };

  const result = applyFilters([spanish, english], { from: null, languages: ['en'] });
  assert.deepEqual(
    result.map((c) => c.external_id),
    ['en'],
  );
});

test('applyFilters marks preprints for approval instead of dropping them', () => {
  const preprint = candidate({ type: 'preprint' });
  const article = candidate({ provider: 'crossref', external_id: 'a', type: 'article' });

  const result = applyFilters([preprint, article], { preprintsRequireApproval: true });
  assert.equal(result.length, 2, 'a preprint is listed, never dropped');
  assert.equal(result[0].needs_approval, true);
  assert.equal(result[1].needs_approval, false);
});

test('applyFilters leaves preprints unflagged when the policy does not require approval', () => {
  const result = applyFilters([candidate({ type: 'preprint' })], {
    preprintsRequireApproval: false,
  });
  assert.equal(result[0].needs_approval, false);
});

test('applyFilters does not mutate its input', () => {
  const c = candidate({ type: 'preprint' });
  applyFilters([c], { preprintsRequireApproval: true });
  assert.equal(c.needs_approval, undefined);
});

test('score sums the rank, citation and recency parts and rounds to three decimals', () => {
  const result = score(candidate({ year: 2023, cited_by: 945 }), 0, { currentYear: 2026 });

  // rank 1/(1+0) = 1; citations log10(946)/4 = 0.744; recency 1 - 3/10 = 0.7
  assert.deepEqual(result.score_parts, { rank: 1, citations: 0.744, recency: 0.7 });
  assert.equal(result.score, 2.444);
});

test('score falls with rank', () => {
  const first = score(candidate(), 0, { currentYear: 2026 }).score_parts.rank;
  const second = score(candidate(), 1, { currentYear: 2026 }).score_parts.rank;
  const tenth = score(candidate(), 9, { currentYear: 2026 }).score_parts.rank;

  assert.equal(first, 1);
  assert.equal(second, 0.5);
  assert.equal(tenth, 0.1);
});

test('score treats an unknown citation count and an unknown year as zero', () => {
  const result = score(candidate({ cited_by: null, year: null }), 0, { currentYear: 2026 });
  assert.deepEqual(result.score_parts, { rank: 1, citations: 0, recency: 0 });
  assert.equal(result.score, 1);
});

test('score gives an uncited work a zero citation part', () => {
  assert.equal(
    score(candidate({ cited_by: 0 }), 0, { currentYear: 2026 }).score_parts.citations,
    0,
  );
});

test('score floors the recency part at zero for anything older than ten years', () => {
  assert.equal(score(candidate({ year: 2010 }), 0, { currentYear: 2026 }).score_parts.recency, 0);
  assert.equal(score(candidate({ year: 2016 }), 0, { currentYear: 2026 }).score_parts.recency, 0);
});

test('score is deterministic for the same inputs', () => {
  const a = score(candidate(), 3, { currentYear: 2026 });
  const b = score(candidate(), 3, { currentYear: 2026 });
  assert.deepEqual(a, b);
});

test('score drops the recency part when no current year is injected', () => {
  const result = score(candidate({ year: 2023 }), 0, {});
  assert.equal(result.score_parts.recency, 0);
});

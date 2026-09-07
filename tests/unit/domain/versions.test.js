import test from 'node:test';
import assert from 'node:assert/strict';
import { linkVersions } from '../../../src/domain/versions.js';

test('same stem different hash links versions, newest is latest', () => {
  const a = {
    id: 'ART-a',
    path: 'sources/thesis_v1.docx',
    hash: '1',
    mtime: '2026-01-01T00:00:00Z',
  };
  const b = {
    id: 'ART-b',
    path: 'sources/thesis_v2.docx',
    hash: '2',
    mtime: '2026-02-01T00:00:00Z',
  };
  const c = { id: 'ART-c', path: 'sources/other.pdf', hash: '3', mtime: '2026-02-01T00:00:00Z' };
  const out = linkVersions([a, b, c]);
  assert.equal(out.find((x) => x.id === 'ART-b').versions_of, 'ART-a');
  assert.equal(out.find((x) => x.id === 'ART-b').latest, true);
  assert.equal(out.find((x) => x.id === 'ART-a').latest, false);
  assert.equal(out.find((x) => x.id === 'ART-c').versions_of, undefined);
});

test('singletons are untouched (no latest key)', () => {
  const a = { id: 'ART-a', path: 'sources/only.pdf', hash: '1', mtime: '2026-01-01T00:00:00Z' };
  const out = linkVersions([a]);
  assert.equal('latest' in out[0], false);
  assert.equal('versions_of' in out[0], false);
});

test('stem normalization strips trailing version/final/draft/copy/date markers', () => {
  const a = { id: 'ART-a', path: 'x/report-final.pdf', hash: '1', mtime: '2026-01-01T00:00:00Z' };
  const b = { id: 'ART-b', path: 'x/report (2).pdf', hash: '2', mtime: '2026-02-01T00:00:00Z' };
  const c = {
    id: 'ART-c',
    path: 'x/report-2026-03-04.pdf',
    hash: '3',
    mtime: '2026-03-01T00:00:00Z',
  };
  const out = linkVersions([a, b, c]);
  assert.equal(out.find((x) => x.id === 'ART-c').versions_of, 'ART-a');
  assert.equal(out.find((x) => x.id === 'ART-c').latest, true);
});

test('same stem but different kind are not linked', () => {
  const a = {
    id: 'ART-a',
    path: 'x/report.pdf',
    kind: 'pdf',
    hash: '1',
    mtime: '2026-01-01T00:00:00Z',
  };
  const b = {
    id: 'ART-b',
    path: 'x/report.xlsx',
    kind: 'xlsx',
    hash: '2',
    mtime: '2026-02-01T00:00:00Z',
  };
  const out = linkVersions([a, b]);
  assert.equal('versions_of' in out.find((x) => x.id === 'ART-a'), false);
  assert.equal('versions_of' in out.find((x) => x.id === 'ART-b'), false);
  assert.equal('latest' in out.find((x) => x.id === 'ART-a'), false);
  assert.equal('latest' in out.find((x) => x.id === 'ART-b'), false);
});

test('same stem and same kind link as versions', () => {
  const a = {
    id: 'ART-a',
    path: 'sources/thesis_v1.docx',
    kind: 'docx',
    hash: '1',
    mtime: '2026-01-01T00:00:00Z',
  };
  const b = {
    id: 'ART-b',
    path: 'sources/thesis_v2.docx',
    kind: 'docx',
    hash: '2',
    mtime: '2026-02-01T00:00:00Z',
  };
  const out = linkVersions([a, b]);
  assert.equal(out.find((x) => x.id === 'ART-b').versions_of, 'ART-a');
  assert.equal(out.find((x) => x.id === 'ART-b').latest, true);
  assert.equal(out.find((x) => x.id === 'ART-a').latest, false);
});

test('does not mutate its input', () => {
  const a = {
    id: 'ART-a',
    path: 'sources/thesis_v1.docx',
    hash: '1',
    mtime: '2026-01-01T00:00:00Z',
  };
  const b = {
    id: 'ART-b',
    path: 'sources/thesis_v2.docx',
    hash: '2',
    mtime: '2026-02-01T00:00:00Z',
  };
  linkVersions([a, b]);
  assert.equal('versions_of' in a, false);
  assert.equal('latest' in a, false);
});

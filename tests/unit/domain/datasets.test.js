import test from 'node:test';
import assert from 'node:assert/strict';
import {
  datasetFormat,
  datasetPath,
  linkDatasetVersions,
  profileTable,
} from '../../../src/domain/datasets.js';
import { PhdudeError } from '../../../src/domain/errors.js';

function rowsOf(header, ...body) {
  return [header, ...body];
}

test('datasetPath normalizes a workspace-relative path under data/', () => {
  assert.equal(datasetPath('data/survey.csv'), 'data/survey.csv');
  assert.equal(datasetPath('./data/survey.csv'), 'data/survey.csv');
  assert.equal(datasetPath('  data/raw/survey.csv  '), 'data/raw/survey.csv');
  assert.equal(datasetPath('data/raw/../survey.csv'), 'data/survey.csv');
});

test('datasetPath refuses anything that is not a file under data/', () => {
  for (const bad of [
    '',
    'survey.csv',
    'sources/survey.csv',
    '../data/survey.csv',
    'data',
    'data/',
  ]) {
    assert.throws(
      () => datasetPath(bad),
      (err) => err instanceof PhdudeError && err.code === 'VALIDATION',
      `${JSON.stringify(bad)} should be refused`,
    );
  }
});

test('datasetPath refuses an absolute path', () => {
  assert.throws(() => datasetPath('/tmp/data/survey.csv'), PhdudeError);
});

test('datasetFormat comes from the extension, and anything unknown is other', () => {
  assert.equal(datasetFormat('data/survey.csv'), 'csv');
  assert.equal(datasetFormat('data/survey.TSV'), 'tsv');
  assert.equal(datasetFormat('data/survey.json'), 'json');
  assert.equal(datasetFormat('data/survey.xlsx'), 'xlsx');
  assert.equal(datasetFormat('data/survey.sav'), 'other');
  assert.equal(datasetFormat('data/survey'), 'other');
});

test('profileTable counts data rows, never the header', () => {
  const profile = profileTable(rowsOf(['id', 'age'], ['1', '31'], ['2', '44']));
  assert.equal(profile.rows, 2);
  assert.deepEqual(
    profile.columns.map((c) => c.name),
    ['id', 'age'],
  );
});

test('profileTable is empty for a table with no rows at all', () => {
  assert.deepEqual(profileTable([]), { rows: 0, columns: [] });
  assert.deepEqual(profileTable(null), { rows: 0, columns: [] });
});

test('profileTable on a header-only table reports zero rows and empty columns', () => {
  const profile = profileTable([['id', 'age']]);
  assert.equal(profile.rows, 0);
  assert.equal(profile.columns.length, 2);
  assert.equal(profile.columns[0].inferred_type, 'empty');
  assert.equal(profile.columns[0].missing, 0);
  assert.equal(profile.columns[0].distinct, 0);
});

test('profileTable infers number when every non-empty cell is numeric', () => {
  const profile = profileTable(rowsOf(['n'], ['1'], ['-2.5'], ['3e4'], ['.5'], ['']));
  assert.equal(profile.columns[0].inferred_type, 'number');
  assert.equal(profile.columns[0].missing, 1);
});

test('profileTable infers boolean from true/false and yes/no, in any case', () => {
  const profile = profileTable(rowsOf(['ok'], ['TRUE'], ['false'], ['Yes'], ['no']));
  assert.equal(profile.columns[0].inferred_type, 'boolean');
});

test('profileTable infers date from YYYY-MM-DD and from full ISO timestamps', () => {
  const plain = profileTable(rowsOf(['at'], ['2026-09-07'], ['1999-01-31']));
  assert.equal(plain.columns[0].inferred_type, 'date');
  const iso = profileTable(rowsOf(['at'], ['2026-09-07T10:00:00Z'], ['2026-09-08T10:00:00+02:00']));
  assert.equal(iso.columns[0].inferred_type, 'date');
});

test('profileTable falls back to string as soon as one cell does not fit', () => {
  const profile = profileTable(rowsOf(['n'], ['1'], ['2'], ['n/a']));
  assert.equal(profile.columns[0].inferred_type, 'string');
});

test('profileTable calls a column of zeros and ones a number, not a boolean', () => {
  const profile = profileTable(rowsOf(['flag'], ['0'], ['1'], ['1']));
  assert.equal(profile.columns[0].inferred_type, 'number');
});

test('profileTable calls a column that is entirely missing empty', () => {
  const profile = profileTable(rowsOf(['note'], [''], ['   '], ['']));
  assert.equal(profile.columns[0].inferred_type, 'empty');
  assert.equal(profile.columns[0].missing, 3);
  assert.equal(profile.columns[0].distinct, 0);
  assert.deepEqual(profile.columns[0].samples, []);
});

test('profileTable counts a short row as a missing cell rather than dropping the column', () => {
  const profile = profileTable(rowsOf(['a', 'b'], ['1', '2'], ['3']));
  assert.equal(profile.columns[1].missing, 1);
  assert.equal(profile.rows, 2);
});

test('profileTable caps distinct at 50 and says so', () => {
  const body = Array.from({ length: 137 }, (_, i) => [`v${i}`]);
  const profile = profileTable(rowsOf(['v'], ...body));
  assert.equal(profile.columns[0].distinct, 50);
  assert.equal(profile.columns[0].distinct_truncated, true);
});

test('profileTable leaves distinct untruncated below the cap', () => {
  const profile = profileTable(rowsOf(['v'], ['a'], ['b'], ['a']));
  assert.equal(profile.columns[0].distinct, 2);
  assert.equal(profile.columns[0].distinct_truncated, false);
});

test('profileTable samples at most five distinct values, in the order they appear', () => {
  const profile = profileTable(rowsOf(['v'], ['b'], ['a'], ['b'], ['c'], ['d'], ['e'], ['f']));
  assert.deepEqual(profile.columns[0].samples, ['b', 'a', 'c', 'd', 'e']);
});

test('profileTable omits samples entirely when the dataset is sensitive', () => {
  const profile = profileTable(rowsOf(['name'], ['Ada'], ['Grace']), { sensitive: true });
  assert.equal(Object.hasOwn(profile.columns[0], 'samples'), false);
  assert.equal(profile.columns[0].distinct, 2);
});

test('profileTable names an unnamed header column by its position', () => {
  const profile = profileTable(rowsOf(['id', '  '], ['1', 'x']));
  assert.equal(profile.columns[1].name, 'column_2');
});

test('profileTable is deterministic over the same table', () => {
  const table = rowsOf(['a', 'b'], ['1', 'x'], ['2', 'y']);
  assert.deepEqual(profileTable(table), profileTable(table));
});

test('linkDatasetVersions leaves the first dataset at a path unlinked', () => {
  const next = { id: 'DATASET-0000000001', path: 'data/s.csv' };
  assert.deepEqual(linkDatasetVersions([], next), { dataset: next, updated: [] });
});

test('linkDatasetVersions points a new version at the oldest and moves latest onto it', () => {
  const first = { id: 'DATASET-aaaaaaaaaa', path: 'data/s.csv', created: '2026-09-01T00:00:00Z' };
  const next = { id: 'DATASET-bbbbbbbbbb', path: 'data/s.csv', created: '2026-09-07T00:00:00Z' };
  const { dataset, updated } = linkDatasetVersions([first], next);
  assert.equal(dataset.versions_of, 'DATASET-aaaaaaaaaa');
  assert.equal(dataset.latest, true);
  assert.deepEqual(updated, [{ ...first, latest: false }]);
});

test('linkDatasetVersions keeps pointing every later version at the oldest', () => {
  const first = { id: 'DATASET-aaaaaaaaaa', path: 'data/s.csv' };
  const second = {
    id: 'DATASET-bbbbbbbbbb',
    path: 'data/s.csv',
    versions_of: first.id,
    latest: true,
  };
  const third = { id: 'DATASET-cccccccccc', path: 'data/s.csv' };
  const { dataset, updated } = linkDatasetVersions([first, second], third);
  assert.equal(dataset.versions_of, 'DATASET-aaaaaaaaaa');
  assert.deepEqual(
    updated.map((d) => [d.id, d.latest]),
    [
      ['DATASET-aaaaaaaaaa', false],
      ['DATASET-bbbbbbbbbb', false],
    ],
  );
});

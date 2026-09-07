import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDoi } from '../../../src/domain/normalize.js';

test('normalizeDoi: strips the resolver prefix and lowercases', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1109/ICCV.2021.00986'), '10.1109/iccv.2021.00986');
  assert.equal(normalizeDoi('http://dx.doi.org/10.1000/XYZ'), '10.1000/xyz');
  assert.equal(normalizeDoi('doi:10.1000/xyz'), '10.1000/xyz');
  assert.equal(normalizeDoi('  10.1000/xyz  '), '10.1000/xyz');
});

test('normalizeDoi: anything that is not a DOI is null', () => {
  for (const value of [
    null,
    undefined,
    42,
    '',
    'not-a-doi',
    'https://example.org/paper',
    '10.1/x',
  ]) {
    assert.equal(normalizeDoi(value), null, `${value} is not a DOI`);
  }
});

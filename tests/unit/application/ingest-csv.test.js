import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../../../src/application/ingest.js';

test('toCsv quotes fields containing commas, quotes, or newlines', () => {
  const csv = toCsv([
    ['a,b', 'say "hi"', 'line1\nline2'],
    ['x', 'y', 'z'],
  ]);
  assert.equal(csv, '"a,b","say ""hi""","line1\nline2"\nx,y,z\n');
});

test('toCsv of an empty row set is an empty string', () => {
  assert.equal(toCsv([]), '');
});

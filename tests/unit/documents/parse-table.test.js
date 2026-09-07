import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTable } from '../../../src/adapters/documents/index.js';

const bytes = (text) => Buffer.from(text, 'utf8');

test('parseTable reads a csv through the text parser, quotes included', async () => {
  const rows = await parseTable(bytes('id,note\n1,"a, b"\n2,plain\n'), 'csv');
  assert.deepEqual(rows, [
    ['id', 'note'],
    ['1', 'a, b'],
    ['2', 'plain'],
  ]);
});

test('parseTable reads a tsv by splitting on tabs', async () => {
  const rows = await parseTable(bytes('id\tnote\n1\ta b\n'), 'tsv');
  assert.deepEqual(rows, [
    ['id', 'note'],
    ['1', 'a b'],
  ]);
});

test('parseTable turns an array of json objects into a header and rows', async () => {
  const rows = await parseTable(
    bytes(
      JSON.stringify([
        { id: 1, ok: true },
        { id: 2, note: 'x' },
      ]),
    ),
    'json',
  );
  assert.deepEqual(rows, [
    ['id', 'ok', 'note'],
    ['1', 'true', ''],
    ['2', '', 'x'],
  ]);
});

test('parseTable declines json that is not an array of objects', async () => {
  assert.equal(await parseTable(bytes('{"a":1}'), 'json'), null);
  assert.equal(await parseTable(bytes('[1,2,3]'), 'json'), null);
  assert.equal(await parseTable(bytes('not json'), 'json'), null);
  assert.equal(await parseTable(bytes('[]'), 'json'), null);
});

test('parseTable declines a format it cannot read', async () => {
  assert.equal(await parseTable(bytes('binary'), 'other'), null);
});

test('parseTable returns an empty table for an empty file', async () => {
  assert.deepEqual(await parseTable(bytes(''), 'csv'), []);
  assert.deepEqual(await parseTable(bytes(''), 'tsv'), []);
});

test('parseTable is deterministic', async () => {
  const buf = bytes('a,b\n1,2\n');
  assert.deepEqual(await parseTable(buf, 'csv'), await parseTable(buf, 'csv'));
});

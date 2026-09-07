import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildFixtures } from '../../../scripts/make-fixtures.mjs';

test('regenerating the fixtures reproduces the committed bytes exactly', async () => {
  const built = buildFixtures();
  for (const [name, buffer] of Object.entries(built)) {
    const committed = await readFile(new URL(`../../fixtures/docs/${name}`, import.meta.url));
    assert.ok(buffer.equals(committed), `${name} differs from the committed fixture`);
  }
});

test('buildFixtures is deterministic across separate calls', () => {
  const a = buildFixtures();
  const b = buildFixtures();
  for (const name of Object.keys(a)) {
    assert.ok(a[name].equals(b[name]), `${name} differs between two buildFixtures() calls`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { validate, assertValid, schemaName, SCHEMA_TYPES } from '../../src/schemas/index.js';
import { PhdudeError } from '../../src/domain/errors.js';
import { SOURCE_TYPES } from '../../src/application/research.js';
for (const bucket of ['valid', 'invalid']) {
  const dir = new URL(`../fixtures/objects/${bucket}/`, import.meta.url);
  for (const f of readdirSync(dir)) {
    test(`${bucket}/${f}`, () => {
      const type = f.split('.')[0];
      const r = validate(type, JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
      assert.equal(r.ok, bucket === 'valid', JSON.stringify(r.errors));
    });
  }
}
test('every schema type has a valid fixture', () => {
  const have = new Set(
    readdirSync(new URL('../fixtures/objects/valid/', import.meta.url)).map((f) => f.split('.')[0]),
  );
  for (const t of SCHEMA_TYPES) assert.ok(have.has(t), t);
});
test('schemaName prefixes the type', () => {
  assert.equal(schemaName('claim'), 'phdude.claim');
});
test('validate rejects an unknown schema type', () => {
  assert.throws(() => validate('bogus', {}), PhdudeError);
});
test('assertValid throws PhdudeError with VALIDATION code and error details', () => {
  const dir = new URL('../fixtures/objects/invalid/', import.meta.url);
  const obj = JSON.parse(readFileSync(new URL('claim.1.json', dir), 'utf8'));
  assert.throws(
    () => assertValid('claim', obj),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      assert.ok(Array.isArray(err.details) && err.details.length > 0);
      return true;
    },
  );
});
test('assertValid does not throw for a valid object', () => {
  const dir = new URL('../fixtures/objects/valid/', import.meta.url);
  const obj = JSON.parse(readFileSync(new URL('claim.1.json', dir), 'utf8'));
  assert.doesNotThrow(() => assertValid('claim', obj));
});

test("research accept's source types are exactly the ones the schema accepts", () => {
  const schema = JSON.parse(
    readFileSync(new URL('../../schemas/source.json', import.meta.url), 'utf8'),
  );
  const enumerated = schema.allOf.find((part) => part.properties?.type)?.properties.type.enum;
  assert.deepEqual([...SOURCE_TYPES].sort(), [...enumerated].sort());
});

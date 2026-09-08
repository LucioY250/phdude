import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA_DIR = join(REPO_ROOT, 'schemas');
const SNAPSHOT_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'schema-snapshot.json');

// The freeze covers the keywords that decide whether a document a reader already has is still
// valid. A property added under `properties` costs an old document nothing; a name added to
// `required`, a value dropped from an `enum`, a changed `const`, a closed object opened or a
// `$ref` repointed all change what a valid document is, and that is the promise 1.0 makes.
const FROZEN_KEYWORDS = [
  '$ref',
  'required',
  'enum',
  'const',
  'additionalProperties',
  'unevaluatedProperties',
];

// The walk follows applicators only, never every object it meets: `schemas/profile.json` has a
// property literally named `required`, and a generic walk would read that property's schema as
// a `required` list.
const SCHEMA_MAPS = new Set(['properties', '$defs', 'patternProperties', 'dependentSchemas']);
const SCHEMA_LISTS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SUB_SCHEMAS = new Set([
  'items',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
]);

const SINCE_RULE =
  'bump x-phdude.since, add a migration if an existing workspace needs one, then re-record with UPDATE_SNAPSHOT=1';
const RECORD_RULE = 'record it with UPDATE_SNAPSHOT=1 and describe it in CHANGELOG.md';

const SNAPSHOT_COMMENT =
  'The frozen public contract of every schema in schemas/. Regenerate with UPDATE_SNAPSHOT=1 only alongside an x-phdude.since bump. See docs/versioning.md.';

const MARKER_LABEL = { $id: '$id', stability: 'x-phdude.stability', since: 'x-phdude.since' };

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function frozenKeywordsOf(node) {
  const frozen = {};
  for (const keyword of FROZEN_KEYWORDS) {
    if (!Object.hasOwn(node, keyword)) continue;
    const value = node[keyword];
    if (keyword === 'required' || keyword === 'enum') frozen[keyword] = [...value].sort();
    else if (value !== null && typeof value === 'object') frozen[keyword] = '<schema>';
    else frozen[keyword] = value;
  }
  return frozen;
}

function contractOf(node, pointer = '', into = {}) {
  const frozen = frozenKeywordsOf(node);
  if (Object.keys(frozen).length > 0) into[pointer || '/'] = frozen;
  for (const [key, value] of Object.entries(node)) {
    if (value === null || typeof value !== 'object') continue;
    if (SCHEMA_MAPS.has(key)) {
      for (const [name, sub] of Object.entries(value))
        contractOf(sub, `${pointer}/${key}/${name}`, into);
    } else if (SCHEMA_LISTS.has(key)) {
      value.forEach((sub, index) => contractOf(sub, `${pointer}/${key}/${index}`, into));
    } else if (SUB_SCHEMAS.has(key)) {
      contractOf(value, `${pointer}/${key}`, into);
    }
  }
  return into;
}

function describe(schema) {
  const marker = schema['x-phdude'] ?? {};
  return {
    $id: schema.$id,
    stability: marker.stability,
    since: marker.since,
    contract: contractOf(schema),
  };
}

function firstDrift(recorded, current) {
  for (const field of ['$id', 'stability', 'since']) {
    if (!same(recorded[field], current[field]))
      return {
        pointer: '/',
        key: MARKER_LABEL[field],
        from: recorded[field],
        to: current[field],
      };
  }
  const pointers = [
    ...new Set([...Object.keys(recorded.contract), ...Object.keys(current.contract)]),
  ].sort();
  for (const pointer of pointers) {
    const before = recorded.contract[pointer] ?? {};
    const after = current.contract[pointer] ?? {};
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      if (!same(before[key], after[key]))
        return { pointer, key, from: before[key], to: after[key] };
    }
  }
  return null;
}

const schemaNames = readdirSync(SCHEMA_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length))
  .sort();

const onDisk = Object.fromEntries(
  schemaNames.map((name) => [
    name,
    JSON.parse(readFileSync(join(SCHEMA_DIR, `${name}.json`), 'utf8')),
  ]),
);

const readSnapshot = () => JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

test('every schema carries an x-phdude stability marker naming the release it shipped in', () => {
  assert.ok(schemaNames.length >= 29, 'the schema directory should not have shrunk');
  for (const [name, schema] of Object.entries(onDisk)) {
    const marker = schema['x-phdude'];
    assert.ok(marker, `schemas/${name}.json is missing its "x-phdude" block`);
    assert.equal(
      marker.stability,
      'stable',
      `schemas/${name}.json must be marked stable at 1.0 (spec §2.1)`,
    );
    assert.match(
      String(marker.since),
      /^\d+\.\d+$/,
      `schemas/${name}.json needs x-phdude.since as MAJOR.MINOR`,
    );
    assert.equal(schema.$id, `phdude://${name}`, `schemas/${name}.json should declare its $id`);
  }
});

test('the frozen contract of every schema matches the recorded snapshot', () => {
  const current = Object.fromEntries(
    Object.entries(onDisk).map(([name, schema]) => [name, describe(schema)]),
  );

  if (process.env.UPDATE_SNAPSHOT) {
    writeFileSync(
      SNAPSHOT_PATH,
      `${JSON.stringify({ $comment: SNAPSHOT_COMMENT, schemas: current }, null, 2)}\n`,
    );
    return;
  }

  const recorded = readSnapshot().schemas;

  for (const name of Object.keys(recorded)) {
    assert.ok(
      current[name],
      `schemas/${name}.json is in the snapshot and gone from disk: removing a stable schema is a major-version change (docs/versioning.md)`,
    );
  }

  for (const [name, entry] of Object.entries(current)) {
    const was = recorded[name];
    assert.ok(was, `schemas/${name}.json is new and unfrozen: ${RECORD_RULE}`);
    const drift = firstDrift(was, entry);
    if (drift === null) continue;
    assert.fail(
      `schemas/${name}.json changed "${drift.key}" at ${drift.pointer}: ` +
        `${JSON.stringify(drift.from ?? null)} → ${JSON.stringify(drift.to ?? null)}. ` +
        (was.since === entry.since ? SINCE_RULE : RECORD_RULE),
    );
  }
});

test('a since bump without a contract change is refused', () => {
  if (process.env.UPDATE_SNAPSHOT) return;
  const recorded = readSnapshot().schemas;
  for (const [name, schema] of Object.entries(onDisk)) {
    const was = recorded[name];
    if (!was) continue;
    const entry = describe(schema);
    if (was.since === entry.since) continue;
    assert.ok(
      !same(was.contract, entry.contract),
      `schemas/${name}.json moved x-phdude.since from ${was.since} to ${entry.since} without changing its contract: since records the release a shape first shipped in, not the release that touched the file`,
    );
  }
});

test('the snapshot covers exactly the schemas on disk', () => {
  if (process.env.UPDATE_SNAPSHOT) return;
  const file = readSnapshot();
  assert.equal(file.$comment, SNAPSHOT_COMMENT);
  assert.deepEqual(Object.keys(file.schemas).sort(), schemaNames);
});

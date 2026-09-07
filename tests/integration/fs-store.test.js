import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { PhdudeError } from '../../src/domain/errors.js';

const actor = { researcher: 'test', agent: 'node' };
const claim = {
  schema: 'phdude.claim',
  version: 1,
  id: 'CLAIM-0123456789',
  created: '2026-09-07T00:00:00Z',
  actor,
  statement: 'x',
  kind: 'empirical',
  state: 'candidate',
  supported_by: [],
  questions: [],
  sections: [],
};

test('write/read/list entities atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  const p = await store.writeEntity(claim);
  assert.equal(p, join(root, 'knowledge', 'claims', 'CLAIM-0123456789.yaml'));
  assert.deepEqual(await store.readEntity('CLAIM-0123456789'), claim);
  assert.equal((await store.listEntities('claim')).length, 1);
  assert.equal(await store.readEntity('CLAIM-ffffffffff'), null);
});
test('writeEntity rejects invalid objects and leaves no file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  await assert.rejects(store.writeEntity({ ...claim, statement: undefined }), /invalid claim/);
  assert.equal(await store.exists('knowledge/claims/CLAIM-0123456789.yaml'), false);
});
test('events append as JSONL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  await store.appendEvent({ ts: '2026-09-07T00:00:00Z', op: 'test', actor, ids: [], summary: 'a' });
  await store.appendEvent({ ts: '2026-09-07T00:00:01Z', op: 'test', actor, ids: [], summary: 'b' });
  const lines = (await readFile(join(root, '.phdude', 'events.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal((await store.readEvents(1))[0].summary, 'b');
});
test('writeEntity rejects a malformed id with a typed error and leaves no file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  await assert.rejects(store.writeEntity({ ...claim, id: 'nope' }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'VALIDATION');
    return true;
  });
  assert.equal(await store.exists('knowledge/claims/nope.yaml'), false);
});
test('writeYamlAtomic leaves no tmp file behind after success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  await store.writeYamlAtomic('knowledge/claims/CLAIM-0123456789.yaml', claim);
  const files = await readdir(join(root, 'knowledge', 'claims'));
  assert.deepEqual(files, ['CLAIM-0123456789.yaml']);
});

test('listEntities and readEntity reject a malformed entity file with a typed error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  await store.writeEntity(claim);
  await writeFile(join(root, 'knowledge', 'claims', 'CLAIM-9999999999.yaml'), '');

  const expected = (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'VALIDATION');
    assert.equal(err.message, 'malformed entity file: knowledge/claims/CLAIM-9999999999.yaml');
    assert.equal(err.hint, 'fix or delete the file');
    return true;
  };

  await assert.rejects(store.listEntities('claim'), expected);
  await assert.rejects(store.readEntity('CLAIM-9999999999'), expected);
});

test('readEntity rejects a file that parses to a non-object or lacks an id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  await mkdir(join(root, 'knowledge', 'claims'), { recursive: true });
  await writeFile(join(root, 'knowledge', 'claims', 'CLAIM-8888888888.yaml'), 'just a string\n');
  await writeFile(join(root, 'knowledge', 'claims', 'CLAIM-7777777777.yaml'), 'statement: x\n');

  await assert.rejects(store.readEntity('CLAIM-8888888888'), /malformed entity file/);
  await assert.rejects(store.readEntity('CLAIM-7777777777'), /malformed entity file/);
});

test('readEntity still returns null for a file that is simply absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  assert.equal(await store.readEntity('CLAIM-0123456789'), null);
});

test('readEntity names a file whose YAML does not parse, such as a merge conflict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  await mkdir(join(root, 'knowledge', 'facts'), { recursive: true });
  const conflicted = [
    '<<<<<<< HEAD',
    'value: 142',
    '=======',
    'value: 151',
    '>>>>>>> theirs',
    '',
  ].join('\n');
  await writeFile(join(root, 'knowledge', 'facts', 'FACT-0123456789.yaml'), conflicted);

  const expected = (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'VALIDATION');
    assert.equal(err.message, 'malformed entity file: knowledge/facts/FACT-0123456789.yaml');
    assert.equal(err.hint, 'fix or delete the file');
    return true;
  };

  await assert.rejects(store.readEntity('FACT-0123456789'), expected);
  await assert.rejects(store.listEntities('fact'), expected);
});

test('readYaml names a policy file whose YAML does not parse', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  await mkdir(join(root, '.phdude'), { recursive: true });
  await writeFile(
    join(root, '.phdude', 'research-policy.yaml'),
    'network:\n  enabled: true\n  providers\n',
  );

  await assert.rejects(store.readYaml(join('.phdude', 'research-policy.yaml')), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'VALIDATION');
    // The path is workspace-relative and slash-separated, so the message names the file the
    // researcher would open regardless of the platform.
    assert.equal(err.message, 'malformed YAML: .phdude/research-policy.yaml');
    assert.equal(err.hint, 'fix the file');
    return true;
  });
});

test('readYaml still returns null for a file that is simply absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  assert.equal(await new FsStore(root).readYaml(join('.phdude', 'research-policy.yaml')), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';

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
test('writeYamlAtomic leaves no tmp file behind after success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-'));
  const store = new FsStore(root);
  await store.writeYamlAtomic('knowledge/claims/CLAIM-0123456789.yaml', claim);
  const files = await readdir(join(root, 'knowledge', 'claims'));
  assert.deepEqual(files, ['CLAIM-0123456789.yaml']);
});

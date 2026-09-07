import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, copyFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { walk, read } from '../../src/adapters/store/fs-walk.js';
import { detectKind, parserFor } from '../../src/adapters/documents/index.js';
import { ingest } from '../../src/application/ingest.js';
import { PhdudeError } from '../../src/domain/errors.js';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'docs');

const actor = { researcher: 'test', agent: 'node' };

function makeDeps(root) {
  let tick = 0;
  return {
    store: new FsStore(root),
    fs: { walk, read },
    parsers: { detectKind, parserFor },
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
    actor,
  };
}

async function setupSources(root) {
  await cp(FIXTURES_DIR, join(root, 'sources'), { recursive: true });
  await mkdir(join(root, 'sources', 'dup'), { recursive: true });
  await copyFile(join(FIXTURES_DIR, 'sample.md'), join(root, 'sources', 'dup', 'sample-copy.md'));
}

test('ingest: discover, dedup, extract, cache, and version-link', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-ingest-'));
  await setupSources(root);
  const deps = makeDeps(root);

  const fixtureFiles = (await readdir(FIXTURES_DIR)).filter((f) => !f.startsWith('.'));
  const uniqueHashCount = fixtureFiles.length; // sample.md's duplicate shares its hash

  const r1 = await ingest(deps, {});
  assert.equal(r1.artifacts.length, uniqueHashCount);
  assert.equal(r1.skipped.length, 0);

  const dupArtifact = r1.artifacts.find((a) => a.paths.length === 2);
  assert.ok(dupArtifact, 'the duplicated sample.md should collapse into one artifact');
  assert.deepEqual([...dupArtifact.paths].sort(), [
    'sources/dup/sample-copy.md',
    'sources/sample.md',
  ]);

  const knowledgeFiles = await readdir(join(root, 'knowledge', 'artifacts'));
  assert.equal(knowledgeFiles.length, uniqueHashCount);

  const docxArtifact = r1.artifacts.find((a) => a.kind === 'docx');
  assert.ok(docxArtifact);
  const cacheText = await readFile(
    join(root, '.phdude', 'cache', docxArtifact.id, 'text.md'),
    'utf8',
  );
  assert.ok(cacheText.length > 0);
  assert.equal(docxArtifact.extracted.status, 'ok');
  assert.equal(docxArtifact.extracted.method, 'ooxml');

  const events1 = (await readFile(join(root, '.phdude', 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n');
  assert.equal(events1.length, 1);
  assert.equal(JSON.parse(events1[0]).op, 'ingest');

  // second run: nothing changed on disk -> everything skipped, exactly one new event line
  const r2 = await ingest(deps, {});
  assert.equal(r2.artifacts.length, 0);
  assert.deepEqual([...r2.skipped].sort(), r1.artifacts.map((a) => a.id).sort());

  const events2 = (await readFile(join(root, '.phdude', 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n');
  assert.equal(events2.length, 2);
  assert.equal(JSON.parse(events2[1]).ids.length, 0);

  // force: true re-extracts everything; created is preserved, event still appended
  const r3 = await ingest(deps, { force: true });
  assert.equal(r3.artifacts.length, uniqueHashCount);
  const docxAfterForce = r3.artifacts.find((a) => a.kind === 'docx');
  assert.equal(docxAfterForce.created, docxArtifact.created);

  const events3 = (await readFile(join(root, '.phdude', 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n');
  assert.equal(events3.length, 3);
});

test('ingest: unknown path rejects with a USAGE PhdudeError', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-ingest-'));
  await mkdir(join(root, 'sources'), { recursive: true });
  const deps = makeDeps(root);
  await assert.rejects(ingest(deps, { paths: ['no-such-dir'] }), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'USAGE');
    return true;
  });
});

test('ingest: a path may point at a single file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-ingest-'));
  await setupSources(root);
  const deps = makeDeps(root);
  const r = await ingest(deps, { paths: ['sources/sample.txt'] });
  assert.equal(r.artifacts.length, 1);
  assert.equal(r.artifacts[0].paths[0], 'sources/sample.txt');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cp,
  mkdir,
  mkdtemp,
  copyFile,
  readFile,
  readdir,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
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

test('ingest: version-links same-stem, same-kind artifacts and persists latest:false on disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-ingest-'));
  await mkdir(join(root, 'sources'), { recursive: true });
  const oldPath = join(root, 'sources', 'report_v1.txt');
  const newPath = join(root, 'sources', 'report_v2.txt');
  await writeFile(oldPath, 'report content v1');
  await writeFile(newPath, 'report content v2, longer');
  const oldTime = new Date('2026-01-01T00:00:00Z');
  const newTime = new Date('2026-02-01T00:00:00Z');
  await utimes(oldPath, oldTime, oldTime);
  await utimes(newPath, newTime, newTime);

  const deps = makeDeps(root);
  const r1 = await ingest(deps, {});
  assert.equal(r1.artifacts.length, 2);

  const oldEntity = r1.artifacts.find((a) => a.path === 'sources/report_v1.txt');
  const newEntity = r1.artifacts.find((a) => a.path === 'sources/report_v2.txt');
  assert.ok(oldEntity && newEntity);

  const onDiskOld1 = await deps.store.readEntity(oldEntity.id);
  const onDiskNew1 = await deps.store.readEntity(newEntity.id);
  assert.equal(onDiskOld1.latest, false);
  assert.equal('versions_of' in onDiskOld1, false);
  assert.equal(onDiskNew1.latest, true);
  assert.equal(onDiskNew1.versions_of, oldEntity.id);

  // second run: nothing changed -> both skipped, and the persisted values are unchanged
  const r2 = await ingest(deps, {});
  assert.deepEqual([...r2.skipped].sort(), [oldEntity.id, newEntity.id].sort());
  assert.equal(r2.artifacts.length, 0);

  const onDiskOld2 = await deps.store.readEntity(oldEntity.id);
  const onDiskNew2 = await deps.store.readEntity(newEntity.id);
  assert.equal(onDiskOld2.latest, false);
  assert.equal('versions_of' in onDiskOld2, false);
  assert.equal(onDiskNew2.latest, true);
  assert.equal(onDiskNew2.versions_of, oldEntity.id);
});

test('ingest: a newly discovered duplicate path merges into the existing artifact without re-extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-ingest-'));
  await mkdir(join(root, 'sources'), { recursive: true });
  await copyFile(join(FIXTURES_DIR, 'sample.md'), join(root, 'sources', 'sample.md'));
  const deps = makeDeps(root);

  const r1 = await ingest(deps, {});
  assert.equal(r1.artifacts.length, 1);
  const id = r1.artifacts[0].id;
  assert.equal(r1.artifacts[0].paths.length, 1);

  const cachePath = join(root, '.phdude', 'cache', id, 'text.md');
  const textBefore = await readFile(cachePath, 'utf8');
  const statBefore = await stat(cachePath);

  await mkdir(join(root, 'sources', 'another'), { recursive: true });
  await copyFile(
    join(FIXTURES_DIR, 'sample.md'),
    join(root, 'sources', 'another', 'sample-again.md'),
  );

  const r2 = await ingest(deps, {});
  assert.ok(!r2.skipped.includes(id), 'the merged artifact should not be reported as skipped');
  const merged = r2.artifacts.find((a) => a.id === id);
  assert.ok(merged, 'the merged artifact should be reported in artifacts');
  assert.equal(merged.paths.length, 2);

  const textAfter = await readFile(cachePath, 'utf8');
  const statAfter = await stat(cachePath);
  assert.equal(textAfter, textBefore);
  assert.equal(statAfter.mtimeMs, statBefore.mtimeMs);
});

test('ingest: a parser that throws yields status failed with a warning, and does not block other files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phdude-ingest-'));
  await mkdir(join(root, 'sources'), { recursive: true });
  await writeFile(join(root, 'sources', 'broken.txt'), 'anything');
  await writeFile(join(root, 'sources', 'fine.txt'), 'ok content');

  const deps = makeDeps(root);
  deps.parsers = {
    detectKind,
    parserFor: (kind) => {
      if (kind !== 'txt') return parserFor(kind);
      return {
        name: 'boom',
        kinds: ['txt'],
        available: async () => true,
        async parse(buffer, { path }) {
          if (path.endsWith('broken.txt')) throw new Error('boom: cannot parse');
          return {
            text: buffer.toString('utf8'),
            sections: [],
            tables: [],
            meta: {},
            warnings: [],
          };
        },
      };
    },
  };

  const r = await ingest(deps, {});
  const broken = r.artifacts.find((a) => a.path === 'sources/broken.txt');
  const fine = r.artifacts.find((a) => a.path === 'sources/fine.txt');
  assert.equal(broken.extracted.status, 'failed');
  assert.ok(broken.extracted.warnings[0].includes('boom: cannot parse'));
  assert.ok(r.warnings.some((w) => w.includes('boom: cannot parse')));
  assert.equal(fine.extracted.status, 'ok');
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { zipSync, strToU8 } from 'fflate';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { ooxmlStyleNames } from '../../src/adapters/documents/ooxml.js';
import { read, realpath } from '../../src/adapters/store/fs-walk.js';
import { CURRENT_WORKSPACE_VERSION } from '../../src/domain/versioning.js';
import { sha256 } from '../../src/domain/hash.js';
import { PhdudeError } from '../../src/domain/errors.js';
import * as template from '../../src/application/template.js';

const run = promisify(execFile);
const actor = { researcher: 'test', agent: 'node' };

function makeDeps(root) {
  let tick = 0;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 8, 7, 10, 0, tick++)).toISOString(),
    actor,
    readBytes: (rel) => read(join(root, rel)),
    realpath,
    ooxmlStyles: ooxmlStyleNames,
  };
}

function fakeDocx(styleIds) {
  const styles = styleIds
    .map((id) => `<w:style w:styleId="${id}"><w:name w:val="${id}"/></w:style>`)
    .join('');
  return Buffer.from(
    zipSync({
      'word/document.xml': strToU8('<w:document/>'),
      'word/styles.xml': strToU8(`<w:styles>${styles}</w:styles>`),
    }),
  );
}

const COMPLETE = ['Heading 1', 'Heading 2', 'Heading 3', 'Body Text', 'Caption'];

async function newRoot({ workspaceVersion = CURRENT_WORKSPACE_VERSION } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-template-'));
  await mkdir(join(root, 'templates', 'university'), { recursive: true });
  await writeFile(
    join(root, 'phdude.yaml'),
    [
      'schema: phdude.project',
      'version: 1',
      `workspace_version: ${workspaceVersion}`,
      'title: Template test',
      'language: en',
      'fields: []',
      'methods: []',
      'outputs: [thesis]',
      'mode: full',
      'agents: [claude-code]',
    ].join('\n') + '\n',
  );
  return root;
}

async function withDocx(
  root,
  rel = 'templates/university/Thesis Template.docx',
  styles = COMPLETE,
) {
  const bytes = fakeDocx(styles);
  await writeFile(join(root, rel), bytes);
  return bytes;
}

test('list on a workspace that never registered a template is empty, not an error', async () => {
  const deps = makeDeps(await newRoot());
  assert.deepEqual(await template.list(deps), []);
});

test('add copies the file under its kind, records name, kind, path and hash, and logs one event', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  const bytes = await withDocx(root);

  const result = await template.add(deps, 'templates/university/Thesis Template.docx');

  assert.equal(result.created, true);
  assert.deepEqual(result.template, {
    name: 'thesis-template',
    kind: 'docx',
    path: 'templates/docx/thesis-template.docx',
    hash: sha256(bytes),
  });
  assert.ok(
    (await readFile(join(root, 'templates/docx/thesis-template.docx'))).equals(bytes),
    'the template was not copied',
  );

  const registry = await deps.store.readYaml(join('.phdude', 'templates.yaml'));
  assert.equal(registry.schema, 'phdude.templates');
  assert.deepEqual(registry.templates, [result.template]);

  const events = await deps.store.readEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].op, 'template');
  assert.match(events[0].summary, /template registered: thesis-template/);
});

test('adding the same file again writes nothing and records no second event', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await withDocx(root);

  await template.add(deps, 'templates/university/Thesis Template.docx');
  const again = await template.add(deps, 'templates/university/Thesis Template.docx');

  assert.equal(again.created, false);
  assert.equal(again.changed, false);
  assert.equal((await deps.store.readEvents()).length, 1);
});

test('adding changed bytes under the same name records the new hash and a second event', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await withDocx(root);
  await template.add(deps, 'templates/university/Thesis Template.docx');

  const changed = await withDocx(root, 'templates/university/Thesis Template.docx', [
    ...COMPLETE,
    'Quote',
  ]);
  const result = await template.add(deps, 'templates/university/Thesis Template.docx');

  assert.equal(result.created, false);
  assert.equal(result.changed, true);
  assert.equal(result.template.hash, sha256(changed));
  assert.equal((await template.list(deps)).length, 1);
  assert.equal((await deps.store.readEvents()).length, 2);
});

test('a template outside the workspace is refused before anything is copied', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await assert.rejects(
    () => template.add(deps, '../escape.docx'),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'USAGE');
      return true;
    },
  );
});

test('a file that is not a template kind PhDude knows is a validation error', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await writeFile(join(root, 'templates', 'notes.odt'), 'x');
  await assert.rejects(() => template.add(deps, 'templates/notes.odt'), PhdudeError);
});

test('use binds a template to a profile and records one event', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await withDocx(root);
  await template.add(deps, 'templates/university/Thesis Template.docx');

  const result = await template.use(deps, 'thesis-template', { profile: 'generic-thesis' });
  assert.equal(result.template.for, 'generic-thesis');
  assert.equal(result.changed, true);

  const again = await template.use(deps, 'thesis-template', { profile: 'generic-thesis' });
  assert.equal(again.changed, false);
  assert.equal((await deps.store.readEvents()).length, 2);
});

test('use on a name that was never registered says how to see the names', async () => {
  const deps = makeDeps(await newRoot());
  await assert.rejects(
    () => template.use(deps, 'ghost', { profile: 'ieee' }),
    (err) => {
      assert.match(err.hint, /phdude template list/);
      return true;
    },
  );
});

test('check reports the styles a DOCX template is missing', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await withDocx(root, 'templates/university/Thesis Template.docx', ['Heading 1', 'Body Text']);
  await template.add(deps, 'templates/university/Thesis Template.docx');

  const report = await template.check(deps, 'thesis-template');
  assert.equal(report.ok, false);
  assert.deepEqual(report.missing, ['Heading 2', 'Heading 3', 'Caption']);
  assert.equal(report.hashMatches, true);
  assert.equal((await deps.store.readEvents()).length, 1, 'check appended an event');
});

test('check passes a template that declares every style Pandoc writes with', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await withDocx(root);
  await template.add(deps, 'templates/university/Thesis Template.docx');

  const report = await template.check(deps, 'thesis-template');
  assert.equal(report.ok, true);
  assert.deepEqual(report.missing, []);
});

test('check reports a registered file that has been edited or removed since', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await withDocx(root);
  await template.add(deps, 'templates/university/Thesis Template.docx');

  await writeFile(join(root, 'templates/docx/thesis-template.docx'), fakeDocx(COMPLETE.slice(1)));
  const report = await template.check(deps, 'thesis-template');
  assert.equal(report.hashMatches, false);
  assert.equal(report.ok, false);
});

test('check on a kind that declares no Word styles says so instead of passing it', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await writeFile(join(root, 'templates', 'slides.pptx'), fakeDocx([]));
  await template.add(deps, 'templates/slides.pptx');

  const report = await template.check(deps, 'slides');
  assert.equal(report.checked, false);
  assert.equal(report.ok, true);
  assert.match(report.reason, /pptx/);
});

// The registered file is what a build hands the renderer, so `check` has to agree with the
// template a researcher most often starts from: the reference DOCX Pandoc ships.
test('check passes the reference DOCX Pandoc ships', async (t) => {
  const root = await newRoot();
  const deps = makeDeps(root);
  try {
    const { stdout } = await run('pandoc', ['--print-default-data-file', 'reference.docx'], {
      encoding: 'buffer',
      maxBuffer: 32 * 1024 * 1024,
    });
    await writeFile(join(root, 'templates', 'reference.docx'), stdout);
  } catch {
    t.skip('pandoc is not installed');
    return;
  }
  await template.add(deps, 'templates/reference.docx');
  const report = await template.check(deps, 'reference');
  assert.deepEqual(report.missing, []);
  assert.equal(report.ok, true);
});

test('a workspace that needs migrating refuses to register a template', async () => {
  const root = await newRoot({ workspaceVersion: 1 });
  const deps = makeDeps(root);
  await withDocx(root);
  await assert.rejects(
    () => template.add(deps, 'templates/university/Thesis Template.docx'),
    (err) => {
      assert.equal(err.code, 'USAGE');
      assert.match(err.hint, /phdude migrate/);
      return true;
    },
  );
});

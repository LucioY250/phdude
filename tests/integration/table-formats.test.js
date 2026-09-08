import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { ooxmlParser } from '../../src/adapters/documents/ooxml.js';
import { parseTable } from '../../src/adapters/documents/index.js';
import { writeXlsx } from '../../src/adapters/render/xlsx.js';
import { read, realpath } from '../../src/adapters/store/fs-walk.js';
import { CURRENT_WORKSPACE_VERSION } from '../../src/domain/versioning.js';
import { newResult } from '../../src/domain/entities.js';
import * as table from '../../src/application/table.js';

const run = promisify(execFile);
const actor = { researcher: 'test', agent: 'node' };

const pandocRenderer = {
  name: 'pandoc',
  formats: ['docx'],
  async available() {
    try {
      const { stdout } = await run('pandoc', ['--version']);
      return { ok: true, version: stdout.split('\n')[0] };
    } catch {
      return { ok: false, hint: 'install pandoc' };
    }
  },
  async render({ input, output, cwd }) {
    await run('pandoc', [input.markdownPath, '-o', output.path], { cwd });
    return { path: output.path, warnings: [] };
  },
};

function fakeDocxRenderer(calls = []) {
  return {
    name: 'fake-docx',
    formats: ['docx'],
    async available() {
      return { ok: true, version: 'fake 1.0' };
    },
    async render({ input, output }) {
      calls.push(input);
      await writeFile(output.path, `docx of ${await readFile(input.markdownPath, 'utf8')}`);
      return { path: output.path, warnings: ['a warning the renderer reported'] };
    },
  };
}

function makeDeps(root, renderers = []) {
  let tick = 0;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 8, 7, 10, 0, tick++)).toISOString(),
    actor,
    readBytes: (rel) => read(join(root, rel)),
    realpath,
    parseTable,
    writeXlsx,
    renderers,
  };
}

async function newRoot() {
  const root = await mkdtemp(join(tmpdir(), 'phdude-table-formats-'));
  await writeFile(
    join(root, 'phdude.yaml'),
    [
      'schema: phdude.project',
      'version: 1',
      `workspace_version: ${CURRENT_WORKSPACE_VERSION}`,
      'title: Table formats test',
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

async function withTable(deps, formats) {
  const result = newResult({
    summary: 'Group b averages more than group a.',
    from: 'ART-0123456789',
    values: { a: 71.4, b: 75.5 },
    actor,
    created: '2026-09-07T09:00:00Z',
  });
  await deps.store.writeEntity(result);
  const { table: declared } = await table.add(deps, {
    name: 'mean-weight',
    caption: 'Mean weight by group.',
    source: { result: result.id },
    columns: [
      { key: 'key', label: 'Group' },
      { key: 'value', label: 'Mean weight', format: 'number:2' },
    ],
    formats,
  });
  return declared;
}

test('a table that declares xlsx builds a workbook without any external tool', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  const declared = await withTable(deps, ['md', 'xlsx']);

  const result = await table.build(deps, declared.id);

  assert.equal(result.built, true);
  assert.deepEqual(
    result.outputs.map((o) => o.path),
    ['tables/out/mean-weight.md', 'tables/out/mean-weight.xlsx'],
  );

  const parsed = await ooxmlParser.parse(
    await readFile(join(root, 'tables/out/mean-weight.xlsx')),
    {
      path: 'mean-weight.xlsx',
    },
  );
  assert.deepEqual(parsed.tables[0].rows, [
    ['Group', 'Mean weight'],
    ['a', '71.4'],
    ['b', '75.5'],
  ]);
  assert.equal(parsed.tables[0].name, 'mean-weight');
});

test('a bare build renders every format the table declares, xlsx included', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  const declared = await withTable(deps, ['xlsx']);

  const result = await table.build(deps, declared.id);
  assert.deepEqual(
    result.outputs.map((o) => o.format),
    ['xlsx'],
  );
});

test('a second xlsx build is up to date, and an edited workbook is rebuilt', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  const declared = await withTable(deps, ['xlsx']);

  await table.build(deps, declared.id);
  const again = await table.build(deps, declared.id);
  assert.equal(again.built, false);
  assert.equal(again.reason, 'up to date');
  assert.equal((await deps.store.readEvents()).length, 2, 'an up-to-date build recorded an event');

  await writeFile(join(root, 'tables/out/mean-weight.xlsx'), 'clobbered');
  const rebuilt = await table.build(deps, declared.id);
  assert.equal(rebuilt.built, true);
});

test('docx without a renderer is a TOOL_MISSING error that names the tool', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  const declared = await withTable(deps, ['docx']);

  await assert.rejects(
    () => table.build(deps, declared.id),
    (err) => {
      assert.equal(err.code, 'TOOL_MISSING');
      assert.match(err.hint, /pandoc/);
      return true;
    },
  );
  assert.equal(await deps.store.exists('tables/out/mean-weight.docx'), false);
});

test('docx is rendered from the Markdown table, and the renderer warnings are carried', async () => {
  const root = await newRoot();
  const calls = [];
  const deps = makeDeps(root, [fakeDocxRenderer(calls)]);
  const declared = await withTable(deps, ['docx']);

  const result = await table.build(deps, declared.id);

  assert.equal(result.built, true);
  assert.deepEqual(result.warnings, ['a warning the renderer reported']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].markdownPath, join(root, '.phdude/cache/tables/mean-weight.md'));

  const docx = await readFile(join(root, 'tables/out/mean-weight.docx'), 'utf8');
  assert.match(docx, /\| Group \| Mean weight \|/);

  const again = await table.build(deps, declared.id);
  assert.equal(again.built, false);
  assert.equal(calls.length, 1, 'an up-to-date build called the renderer again');
});

test('a docx a build never recorded is rendered even when a file is sitting there', async () => {
  const root = await newRoot();
  const calls = [];
  const deps = makeDeps(root, [fakeDocxRenderer(calls)]);
  const declared = await withTable(deps, ['docx']);

  await table.build(deps, declared.id);
  await writeFile(join(root, 'tables/out/mean-weight.docx'), 'someone else wrote this');
  const rebuilt = await table.build(deps, declared.id);

  assert.equal(rebuilt.built, true);
  assert.equal(calls.length, 2);
});

test('a format the table does not declare is still refused', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  const declared = await withTable(deps, ['md']);
  await assert.rejects(
    () => table.build(deps, declared.id, { formats: ['xlsx'] }),
    (err) => {
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /does not declare format\(s\): xlsx/);
      return true;
    },
  );
});

test('Pandoc itself turns the Markdown table into a DOCX', async (t) => {
  const root = await newRoot();
  const deps = makeDeps(root, [pandocRenderer]);
  if (!(await pandocRenderer.available()).ok) {
    t.skip('pandoc is not installed');
    return;
  }
  const declared = await withTable(deps, ['docx']);
  await table.build(deps, declared.id);

  const parsed = await ooxmlParser.parse(
    await readFile(join(root, 'tables/out/mean-weight.docx')),
    { path: 'mean-weight.docx' },
  );
  assert.equal(parsed.tables.length, 1);
  assert.deepEqual(parsed.tables[0].rows[0], ['Group', 'Mean weight']);
  assert.deepEqual(parsed.tables[0].rows[1], ['a', '71.40']);
});

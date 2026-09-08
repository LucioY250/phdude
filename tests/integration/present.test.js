import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { read, realpath } from '../../src/adapters/store/fs-walk.js';
import { CURRENT_WORKSPACE_VERSION } from '../../src/domain/versioning.js';
import { PhdudeError } from '../../src/domain/errors.js';
import * as present from '../../src/application/present.js';
import * as template from '../../src/application/template.js';

const run = promisify(execFile);
const actor = { researcher: 'test', agent: 'node' };

// The renderer port T1 ships, as far as `present` uses it: enough to prove the application
// hands a Markdown file and a reference document to something and gets a file back.
function fakeRenderer({ ok = true, hint = null, calls = [] } = {}) {
  return {
    name: 'fake-pptx',
    formats: ['pptx'],
    async available() {
      return ok ? { ok: true, version: 'fake 1.0' } : { ok: false, hint };
    },
    async render({ input, output }) {
      calls.push({ input, output });
      await writeFile(output.path, `pptx of ${input.markdownPath}`);
      return { path: output.path, warnings: [] };
    },
  };
}

// The same port shape over the real tool, so the arguments are exercised against Pandoc itself
// wherever it is installed and skipped honestly where it is not.
const pandocRenderer = {
  name: 'pandoc',
  formats: ['pptx'],
  async available() {
    try {
      const { stdout } = await run('pandoc', ['--version']);
      return { ok: true, version: stdout.split('\n')[0] };
    } catch {
      return { ok: false, hint: 'install pandoc' };
    }
  },
  async render({ input, output, cwd }) {
    const args = [input.markdownPath, '-o', output.path];
    if (input.referenceDoc) args.push('--reference-doc', input.referenceDoc);
    await run('pandoc', args, { cwd });
    return { path: output.path, warnings: [] };
  },
};

function makeDeps(root, renderers = []) {
  let tick = 0;
  return {
    store: new FsStore(root),
    clock: () => new Date(Date.UTC(2026, 8, 7, 10, 0, tick++)).toISOString(),
    actor,
    readBytes: (rel) => read(join(root, rel)),
    realpath,
    renderers,
  };
}

async function newRoot({ workspaceVersion = CURRENT_WORKSPACE_VERSION } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-present-'));
  await mkdir(join(root, 'outputs'), { recursive: true });
  await mkdir(join(root, 'templates'), { recursive: true });
  await writeFile(
    join(root, 'phdude.yaml'),
    [
      'schema: phdude.project',
      'version: 1',
      `workspace_version: ${workspaceVersion}`,
      'title: Present test',
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

const CLAIM = {
  schema: 'phdude.claim',
  version: 1,
  id: 'CLAIM-0123456789',
  created: '2026-09-07T09:00:00Z',
  actor,
  tags: [],
  statement: 'Caffeine after 14:00 delays sleep onset.',
  kind: 'empirical',
  state: 'canonical',
  supported_by: ['EVID-0123456789'],
  questions: [],
  sections: ['results'],
};

const EVIDENCE = {
  schema: 'phdude.evidence',
  version: 1,
  id: 'EVID-0123456789',
  created: '2026-09-07T09:00:00Z',
  actor,
  tags: [],
  source: 'SRC-0123456789',
  locator: 'p. 12',
  excerpt: 'A randomised trial of 312 adults found a 41-minute delay.',
  strength: 'strong',
  state: 'canonical',
};

async function withManuscript(store, { status = 'approved' } = {}) {
  await store.writeManuscript({
    schema: 'phdude.manuscript',
    version: 1,
    title: 'Coffee and Sleep',
    language: 'en',
    voice: { kind: 'consensus' },
    sections: [
      {
        id: 'results',
        title: 'Results',
        file: 'manuscript/results.md',
        order: 1,
        status,
        hash: null,
        claims: [CLAIM.id],
        questions: [],
      },
    ],
  });
  await store.writeEntity(CLAIM);
  await store.writeEntity(EVIDENCE);
}

test('the outline is written under outputs/<slug>/ and recorded with one event', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await withManuscript(deps.store);

  const result = await present.outline(deps, {});

  assert.equal(result.written, true);
  assert.equal(result.slides, 1);
  assert.deepEqual(
    result.outputs.map((o) => o.path),
    ['outputs/coffee-and-sleep/outline.md'],
  );

  const md = await readFile(join(root, 'outputs/coffee-and-sleep/outline.md'), 'utf8');
  assert.match(md, /^# Coffee and Sleep$/m);
  assert.match(md, /^## Results$/m);
  assert.match(md, /A randomised trial of 312 adults found a 41-minute delay\. \(p\. 12\)/);

  const events = await deps.store.readEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].op, 'present');
  assert.match(events[0].summary, /outline written/);
});

test('a second outline over unchanged research writes nothing and records nothing', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await withManuscript(deps.store);

  await present.outline(deps, {});
  const again = await present.outline(deps, {});

  assert.equal(again.written, false);
  assert.equal(again.reason, 'up to date');
  assert.equal((await deps.store.readEvents()).length, 1);

  const forced = await present.outline(deps, { force: true });
  assert.equal(forced.written, true);
  assert.equal((await deps.store.readEvents()).length, 2);
});

test('--from claims outlines the claims the evidence supports', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await withManuscript(deps.store, { status: 'draft' });

  const result = await present.outline(deps, { from: 'claims' });
  const md = await readFile(join(root, result.outputs[0].path), 'utf8');
  assert.match(md, /^## Caffeine after 14:00 delays sleep onset\.$/m);
});

test('without a renderer the Markdown is still written and the missing tool is named', async () => {
  const root = await newRoot();
  const deps = makeDeps(root);
  await withManuscript(deps.store);

  const result = await present.outline(deps, {});
  assert.equal(result.written, true);
  assert.equal(
    result.outputs.some((o) => o.format === 'pptx'),
    false,
  );
  assert.match(result.warnings.join(' '), /pptx/);
  assert.match(result.warnings.join(' '), /pandoc/i);
});

test('with a renderer the outline is also rendered to PPTX, through the registered template', async () => {
  const root = await newRoot();
  const calls = [];
  const deps = makeDeps(root, [fakeRenderer({ calls })]);
  await withManuscript(deps.store);

  await writeFile(join(root, 'templates', 'defence.pptx'), 'template bytes');
  await template.add({ ...deps, ooxmlStyles: () => [] }, 'templates/defence.pptx', {});
  await template.use(deps, 'defence', { profile: 'generic-thesis' });

  const result = await present.outline(deps, { profile: 'generic-thesis' });

  assert.deepEqual(
    result.outputs.map((o) => o.format),
    ['md', 'pptx'],
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.markdownPath, join(root, 'outputs/coffee-and-sleep/outline.md'));
  assert.equal(calls[0].input.referenceDoc, join(root, 'templates/pptx/defence.pptx'));
  assert.equal(calls[0].output.format, 'pptx');
  assert.ok(await stat(join(root, 'outputs/coffee-and-sleep/outline.pptx')));
  assert.match((await deps.store.readEvents()).at(-1).summary, /outline\.pptx/);
});

test('an unavailable renderer is reported with the hint it gave, not called', async () => {
  const root = await newRoot();
  const calls = [];
  const deps = makeDeps(root, [fakeRenderer({ ok: false, hint: 'apt install pandoc', calls })]);
  await withManuscript(deps.store);

  const result = await present.outline(deps, {});
  assert.equal(calls.length, 0);
  assert.match(result.warnings.join(' '), /apt install pandoc/);
});

test('Pandoc itself turns the outline into a slide deck', async (t) => {
  const root = await newRoot();
  const deps = makeDeps(root, [pandocRenderer]);
  if (!(await pandocRenderer.available()).ok) {
    t.skip('pandoc is not installed');
    return;
  }
  await withManuscript(deps.store);

  const result = await present.outline(deps, {});
  const pptx = result.outputs.find((o) => o.format === 'pptx');
  assert.ok(pptx, `pptx was not rendered: ${result.warnings.join(' ')}`);

  const { ooxmlParser } = await import('../../src/adapters/documents/ooxml.js');
  const parsed = await ooxmlParser.parse(await readFile(join(root, pptx.path)), {
    path: 'outline.pptx',
  });
  assert.match(parsed.text, /Results/);
  assert.match(parsed.text, /41-minute delay/);
});

test('a workspace with no manuscript is told to start one', async () => {
  const deps = makeDeps(await newRoot());
  await assert.rejects(
    () => present.outline(deps, {}),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.hint, /manuscript init/);
      return true;
    },
  );
});

test('a workspace that needs migrating refuses to write an outline', async () => {
  const root = await newRoot({ workspaceVersion: 1 });
  const deps = makeDeps(root);
  await assert.rejects(
    () => present.outline(deps, {}),
    (err) => {
      assert.equal(err.code, 'USAGE');
      assert.match(err.hint, /phdude migrate/);
      return true;
    },
  );
});

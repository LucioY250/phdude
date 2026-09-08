import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentRendererContract } from '../../src/ports/document-renderer.js';
import { buildRenderers, rendererFor } from '../../src/adapters/render/index.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'render');

// The three shipped renderers, wired the way `src/adapters/cli/run.js` wires them. Markdown is
// always available; the other two run their half of the suite only where the tool is installed,
// and say what they skipped where it is not.
const renderers = buildRenderers({ execFile, env: process.env, version: '0.6.0' });

for (const renderer of renderers) {
  documentRendererContract(test, assert, renderer, { fixturesDir: FIXTURES });
}

test('buildRenderers: ships markdown, pandoc and latex, in precedence order', () => {
  assert.deepEqual(
    renderers.map((r) => r.name),
    ['markdown', 'pandoc', 'latex'],
  );
});

test('rendererFor: md is the built-in renderer even when pandoc is installed', () => {
  assert.equal(rendererFor(renderers, 'md').name, 'markdown');
});

test('rendererFor: docx, pptx, html and latex go to pandoc, pdf to the latex adapter', () => {
  for (const format of ['docx', 'pptx', 'html', 'latex']) {
    assert.equal(rendererFor(renderers, format).name, 'pandoc', format);
  }
  assert.equal(rendererFor(renderers, 'pdf').name, 'latex');
});

test('rendererFor: a format nothing renders is a VALIDATION error listing the ones that do', () => {
  assert.throws(
    () => rendererFor(renderers, 'epub'),
    (err) => {
      assert.equal(err.name, 'PhdudeError');
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.message, /epub/);
      assert.match(err.hint, /docx.*html.*latex.*md.*pdf.*pptx/);
      return true;
    },
  );
});

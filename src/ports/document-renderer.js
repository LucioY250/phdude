import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * What a renderer says about the tool behind it. `ok` is the only field a caller may branch on;
 * an available renderer names its `version` (so a build can record what produced the bytes) and
 * an unavailable one names the `hint` that would install it.
 * @typedef {object} RendererAvailability
 * @property {boolean} ok
 * @property {string} [version]
 * @property {string} [hint]
 */

/**
 * Everything a render reads. `markdownPath` is the assembled manuscript; the rest are optional
 * and a renderer that cannot use one says so in `warnings` rather than failing. `metadata` is a
 * flat map of scalars and arrays of scalars (title, author, date, abstract) - a fixed `date` is
 * what makes two builds of the same manuscript produce the same bytes.
 * @typedef {object} RenderInput
 * @property {string} markdownPath
 * @property {string} [bibPath]
 * @property {string} [cslPath]
 * @property {string} [referenceDoc]
 * @property {string} [template]
 * @property {Record<string, string|number|(string|number)[]>} [metadata]
 */

/**
 * @typedef {object} DocumentRenderer
 * @property {string} name
 * @property {string[]} formats - the format names this renderer accepts, lowercase
 * @property {() => Promise<RendererAvailability>} available
 * @property {(opts: {input: RenderInput, output: {path: string, format: string}, cwd: string})
 *   => Promise<{path: string, warnings: string[]}>} render
 *
 * The rules every implementation follows, in this order. A request that is malformed - a
 * format the renderer does not declare, an input file that is not on disk - is a `VALIDATION`
 * error whether or not the tool is installed, because a missing tool is not what is wrong with
 * it. A renderer whose tool is absent then refuses with `TOOL_MISSING` carrying the install
 * hint. Only then does it render, creating the output's parent directory if it has to, and
 * returning the absolute path it wrote.
 */

// Formats whose bytes the spec promises are reproducible: identical inputs and an identical
// renderer version render identical files. DOCX, PPTX and PDF are best-effort and not checked.
const REPRODUCIBLE = new Set(['md', 'latex', 'html']);

const MAGIC = { docx: 'PK', pptx: 'PK', pdf: '%PDF' };

/**
 * Registers the node:test cases every DocumentRenderer implementation must satisfy.
 * `fixturesDir` holds `sample.md`, whose text the rendered output has to carry.
 * @param {typeof import('node:test').test} test
 * @param {typeof import('node:assert/strict')} assert
 * @param {DocumentRenderer} renderer
 * @param {{fixturesDir: string}} fixtures
 */
export function documentRendererContract(test, assert, renderer, { fixturesDir }) {
  const name = renderer.name;
  const markdownPath = join(fixturesDir, 'sample.md');
  const metadata = { title: 'Sample manuscript', date: '2026-09-07' };

  async function withTempDir(body) {
    const dir = await mkdtemp(join(tmpdir(), 'phdude-render-'));
    try {
      return await body(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test(`${name}: exposes the DocumentRenderer shape`, () => {
    assert.equal(typeof renderer.name, 'string');
    assert.ok(renderer.name.length > 0);
    assert.ok(Array.isArray(renderer.formats) && renderer.formats.length > 0);
    for (const format of renderer.formats) assert.equal(format, format.toLowerCase());
    assert.equal(typeof renderer.available, 'function');
    assert.equal(typeof renderer.render, 'function');
  });

  test(`${name}: available() reports honestly, with a version or an install hint`, async () => {
    const availability = await renderer.available();
    assert.equal(typeof availability.ok, 'boolean');
    if (availability.ok) {
      assert.ok(
        typeof availability.version === 'string' && availability.version.length > 0,
        'an available renderer names the version that produced the bytes',
      );
    } else {
      assert.ok(
        typeof availability.hint === 'string' && availability.hint.length > 0,
        'an unavailable renderer names what would install it',
      );
    }
    assert.deepEqual(await renderer.available(), availability, 'available() is stable');
  });

  test(`${name}: an input file that is not on disk is a VALIDATION error`, async () => {
    await withTempDir(async (dir) => {
      await assert.rejects(
        renderer.render({
          input: { markdownPath: join(dir, 'not-written.md'), metadata },
          output: { path: join(dir, `out.${renderer.formats[0]}`), format: renderer.formats[0] },
          cwd: dir,
        }),
        (err) => {
          assert.equal(err.name, 'PhdudeError');
          assert.equal(err.code, 'VALIDATION');
          assert.match(err.message, /not-written\.md/);
          return true;
        },
      );
    });
  });

  test(`${name}: a format it does not declare is a VALIDATION error naming the ones it does`, async () => {
    await withTempDir(async (dir) => {
      await assert.rejects(
        renderer.render({
          input: { markdownPath, metadata },
          output: { path: join(dir, 'out.xyz'), format: 'xyz' },
          cwd: dir,
        }),
        (err) => {
          assert.equal(err.name, 'PhdudeError');
          assert.equal(err.code, 'VALIDATION');
          assert.match(err.message, /xyz/);
          assert.match(String(err.hint), new RegExp(renderer.formats[0]));
          return true;
        },
      );
    });
  });

  for (const format of renderer.formats) {
    test(`${name}: renders ${format}, or refuses with TOOL_MISSING and the install hint`, async () => {
      const availability = await renderer.available();
      await withTempDir(async (dir) => {
        // A directory the caller has not created yet: a build writes into `outputs/<slug>/`,
        // and a renderer that made the caller mkdir first would push that on every caller.
        const output = { path: join(dir, 'nested', `out.${format}`), format };
        const call = renderer.render({ input: { markdownPath, metadata }, output, cwd: dir });

        if (!availability.ok) {
          await assert.rejects(call, (err) => {
            assert.equal(err.name, 'PhdudeError');
            assert.equal(err.code, 'TOOL_MISSING');
            assert.ok(typeof err.hint === 'string' && err.hint.length > 0);
            return true;
          });
          return;
        }

        const result = await call;
        assert.equal(result.path, output.path);
        assert.ok(Array.isArray(result.warnings));
        const written = await readFile(result.path);
        assert.ok((await stat(result.path)).size > 0, 'a rendered file is never empty');
        if (MAGIC[format]) {
          assert.equal(written.subarray(0, MAGIC[format].length).toString('latin1'), MAGIC[format]);
        } else {
          assert.match(written.toString('utf8'), /312 participants/);
        }
      });
    });

    if (!REPRODUCIBLE.has(format)) continue;

    test(`${name}: rendering ${format} twice from the same input writes the same bytes`, async (t) => {
      const availability = await renderer.available();
      if (!availability.ok) {
        t.skip(`${name} is not available on this machine: ${availability.hint}`);
        return;
      }
      await withTempDir(async (dir) => {
        const render = async (n) => {
          const path = join(dir, `run-${n}.${format}`);
          await renderer.render({
            input: { markdownPath, metadata },
            output: { path, format },
            cwd: dir,
          });
          return readFile(path);
        };
        assert.deepEqual(await render(1), await render(2));
      });
    });
  }
}

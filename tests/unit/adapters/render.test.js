import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdownRenderer } from '../../../src/adapters/render/markdown.js';
import { pandocRenderer } from '../../../src/adapters/render/pandoc.js';
import { latexRenderer } from '../../../src/adapters/render/latex.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'render');
const SAMPLE = join(FIXTURES, 'sample.md');
const CITED = join(FIXTURES, 'cited.md');
const BIB = join(FIXTURES, 'references.bib');

async function withTempDir(body) {
  const dir = await mkdtemp(join(tmpdir(), 'phdude-render-unit-'));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// A stand-in for node's execFile: it records every call and answers from `handlers`, keyed by
// the executable. A handler may write the file the real tool would have written.
function fakeExecFile(handlers = {}) {
  const calls = [];
  const fn = (file, args, options, callback) => {
    calls.push({ file, args, options });
    const handler = handlers[file] ?? (() => ({ stdout: '', stderr: '' }));
    Promise.resolve()
      .then(() => handler({ file, args, options }))
      .then(
        (result) => callback(null, result?.stdout ?? '', result?.stderr ?? ''),
        (err) => callback(err, err.stdout ?? '', err.stderr ?? ''),
      );
  };
  fn.calls = calls;
  return fn;
}

function enoent(file) {
  const err = new Error(`spawn ${file} ENOENT`);
  err.code = 'ENOENT';
  return err;
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}

const markdown = () => markdownRenderer({ version: '0.6.0' });

test('markdown: is always available and names the phdude version behind the bytes', async () => {
  const availability = await markdown().available();
  assert.equal(availability.ok, true);
  assert.match(availability.version, /0\.6\.0/);
});

test('markdown: md renders the source text through, with no bibliography and no front matter', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'manuscript.md');
    const result = await markdown().render({
      input: { markdownPath: SAMPLE },
      output: { path, format: 'md' },
      cwd: dir,
    });
    assert.deepEqual(result.warnings, []);
    assert.equal(await readFile(path, 'utf8'), await readFile(SAMPLE, 'utf8'));
  });
});

test('markdown: metadata becomes YAML front matter, title, author and date first', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'manuscript.md');
    await markdown().render({
      input: {
        markdownPath: SAMPLE,
        metadata: {
          subtitle: 'A worked example',
          date: '2026-09-07',
          title: 'Sample manuscript',
          author: ['Ada Lovelace', 'Charles Babbage'],
        },
      },
      output: { path, format: 'md' },
      cwd: dir,
    });
    const written = await readFile(path, 'utf8');
    assert.match(
      written,
      /^---\ntitle: Sample manuscript\nauthor:\n {2}- Ada Lovelace\n {2}- Charles Babbage\ndate: [^\n]*2026-09-07[^\n]*\nsubtitle: A worked example\n---\n\n# Sample manuscript\n/,
      written,
    );
  });
});

test('markdown: citations resolve to author-year and gain a reference list from the bib', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'manuscript.md');
    const result = await markdown().render({
      input: { markdownPath: CITED, bibPath: BIB },
      output: { path, format: 'md' },
      cwd: dir,
    });
    const written = await readFile(path, 'utf8');
    assert.match(written, /\(Lovelace and Babbage, 2020\)/);
    assert.match(written, /\(Babbage, 2021; Hopper, 1952\)/);
    assert.match(written, /\(see Hopper, 1952\)/);
    assert.match(written, /## References/);
    assert.match(written, /Babbage, C\. \(2021\)\. Difference Engines Revisited\./);
    assert.deepEqual(result.warnings, []);
  });
});

test('markdown: a key the bibliography does not carry is a warning, not a silent drop', async () => {
  await withTempDir(async (dir) => {
    const source = join(dir, 'body.md');
    await writeFile(source, 'Unknown [@nosuchkey].\n');
    const result = await markdown().render({
      input: { markdownPath: source, bibPath: BIB },
      output: { path: join(dir, 'out.md'), format: 'md' },
      cwd: dir,
    });
    assert.deepEqual(result.warnings, [
      '[@nosuchkey] does not resolve to an entry in the bibliography',
    ]);
    assert.match(await readFile(join(dir, 'out.md'), 'utf8'), /\(@nosuchkey\)/);
  });
});

test('markdown: an input the caller named but did not write is a VALIDATION error', async () => {
  await withTempDir(async (dir) => {
    for (const [key, value] of [
      ['markdownPath', join(dir, 'missing.md')],
      ['bibPath', join(dir, 'missing.bib')],
    ]) {
      await assert.rejects(
        markdown().render({
          input: { markdownPath: SAMPLE, [key]: value },
          output: { path: join(dir, 'out.md'), format: 'md' },
          cwd: dir,
        }),
        (err) => {
          assert.equal(err.code, 'VALIDATION');
          assert.match(err.message, /missing\.(md|bib)/);
          return true;
        },
      );
    }
  });
});

test('markdown: a CSL style or a reference document it cannot honour is reported, not ignored', async () => {
  await withTempDir(async (dir) => {
    const csl = join(dir, 'apa.csl');
    await writeFile(csl, '<style/>');
    const result = await markdown().render({
      input: { markdownPath: CITED, bibPath: BIB, cslPath: csl },
      output: { path: join(dir, 'out.md'), format: 'md' },
      cwd: dir,
    });
    assert.deepEqual(result.warnings, [
      'the built-in markdown renderer has no CSL support; apa.csl was not applied, references are plain author-year',
    ]);
  });
});

test('markdown: a relative output path is resolved against cwd and comes back absolute', async () => {
  await withTempDir(async (dir) => {
    const result = await markdown().render({
      input: { markdownPath: SAMPLE },
      output: { path: join('outputs', 'thesis', 'manuscript.md'), format: 'md' },
      cwd: dir,
    });
    assert.equal(result.path, join(dir, 'outputs', 'thesis', 'manuscript.md'));
    assert.match(await readFile(result.path, 'utf8'), /312 participants/);
  });
});

test('pandoc: available() reads the version off `pandoc --version`', async () => {
  const execFile = fakeExecFile({
    pandoc: () => ({ stdout: 'pandoc 3.6.4\nFeatures: +server +lua\n' }),
  });
  const availability = await pandocRenderer({ execFile, env: {} }).available();
  assert.deepEqual(availability, { ok: true, version: '3.6.4' });
  assert.deepEqual(execFile.calls[0].args, ['--version']);
});

test('pandoc: a pandoc that is not installed is unavailable with an install hint', async () => {
  const execFile = fakeExecFile({
    pandoc: () => {
      throw enoent('pandoc');
    },
  });
  const availability = await pandocRenderer({ execFile, env: {} }).available();
  assert.equal(availability.ok, false);
  assert.match(availability.hint, /install pandoc/);
  assert.equal(availability.version, undefined);
});

test('pandoc: PHDUDE_PANDOC points the adapter at a user-local install', async () => {
  const execFile = fakeExecFile({ '/opt/pandoc/bin/pandoc': () => ({ stdout: 'pandoc 3.6.4\n' }) });
  const renderer = pandocRenderer({ execFile, env: { PHDUDE_PANDOC: '/opt/pandoc/bin/pandoc' } });
  assert.equal((await renderer.available()).ok, true);
  assert.equal(execFile.calls[0].file, '/opt/pandoc/bin/pandoc');
});

test('pandoc: an unavailable pandoc refuses to render with TOOL_MISSING', async () => {
  await withTempDir(async (dir) => {
    const execFile = fakeExecFile({
      pandoc: () => {
        throw enoent('pandoc');
      },
    });
    await assert.rejects(
      pandocRenderer({ execFile, env: {} }).render({
        input: { markdownPath: SAMPLE },
        output: { path: join(dir, 'out.docx'), format: 'docx' },
        cwd: dir,
      }),
      (err) => {
        assert.equal(err.code, 'TOOL_MISSING');
        assert.match(err.hint, /install pandoc/);
        return true;
      },
    );
  });
});

test('pandoc: the argument array carries the bibliography, the CSL and the reference document', async () => {
  await withTempDir(async (dir) => {
    const csl = join(dir, 'ieee.csl');
    const reference = join(dir, 'reference.docx');
    await writeFile(csl, '<style/>');
    await writeFile(reference, 'PK');
    const execFile = fakeExecFile({
      pandoc: async ({ args }) => {
        await writeFile(argValue(args, '--output'), 'PK rendered');
        return { stdout: '' };
      },
    });
    const result = await pandocRenderer({ execFile, env: { PHDUDE_PANDOC: 'pandoc' } }).render({
      input: {
        markdownPath: SAMPLE,
        bibPath: BIB,
        cslPath: csl,
        referenceDoc: reference,
        metadata: { title: 'Sample manuscript', author: ['Ada Lovelace', 'Charles Babbage'] },
      },
      output: { path: join(dir, 'out.docx'), format: 'docx' },
      cwd: dir,
    });

    const { args, options } = execFile.calls.at(-1);
    assert.deepEqual(args, [
      '--from',
      'markdown',
      '--to',
      'docx',
      '--output',
      join(dir, 'out.docx'),
      '--citeproc',
      '--bibliography',
      BIB,
      '--csl',
      csl,
      '--reference-doc',
      reference,
      '--metadata',
      'author=Ada Lovelace',
      '--metadata',
      'author=Charles Babbage',
      '--metadata',
      'title=Sample manuscript',
      SAMPLE,
    ]);
    assert.equal(options.cwd, dir);
    assert.deepEqual(result.warnings, []);
  });
});

test('pandoc: latex and html are rendered standalone so the output compiles on its own', async () => {
  await withTempDir(async (dir) => {
    const execFile = fakeExecFile({
      pandoc: async ({ args }) => {
        await writeFile(argValue(args, '--output'), '\\documentclass{article}');
        return { stdout: '' };
      },
    });
    await pandocRenderer({ execFile, env: {} }).render({
      input: { markdownPath: SAMPLE },
      output: { path: join(dir, 'out.tex'), format: 'latex' },
      cwd: dir,
    });
    assert.ok(execFile.calls.at(-1).args.includes('--standalone'));
  });
});

test('pandoc: a template or reference document the format cannot use is a warning, not an argument', async () => {
  await withTempDir(async (dir) => {
    const reference = join(dir, 'reference.docx');
    await writeFile(reference, 'PK');
    const execFile = fakeExecFile({
      pandoc: async ({ args }) => {
        await writeFile(argValue(args, '--output'), 'x');
        return { stdout: '' };
      },
    });
    const result = await pandocRenderer({ execFile, env: {} }).render({
      input: { markdownPath: SAMPLE, referenceDoc: reference },
      output: { path: join(dir, 'out.tex'), format: 'latex' },
      cwd: dir,
    });
    assert.ok(!execFile.calls.at(-1).args.includes('--reference-doc'));
    assert.deepEqual(result.warnings, [
      'a reference document applies to docx and pptx only; reference.docx was not applied to latex',
    ]);
  });
});

test('pandoc: a non-zero exit is an EXECUTION error carrying what pandoc said', async () => {
  await withTempDir(async (dir) => {
    const execFile = fakeExecFile({
      pandoc: () => {
        const err = new Error('Command failed');
        err.code = 43;
        err.stderr = 'Error at "input" (line 3, column 1):\nunexpected \'{\'\n';
        throw err;
      },
    });
    await assert.rejects(
      pandocRenderer({ execFile, env: {} }).render({
        input: { markdownPath: SAMPLE },
        output: { path: join(dir, 'out.html'), format: 'html' },
        cwd: dir,
      }),
      (err) => {
        assert.equal(err.code, 'EXECUTION');
        assert.match(err.message, /pandoc failed/);
        assert.ok(err.details.some((d) => /unexpected/.test(d)));
        return true;
      },
    );
  });
});

test('pandoc: an exit 0 that wrote no file is a failure, never a rendered document', async () => {
  await withTempDir(async (dir) => {
    const execFile = fakeExecFile({ pandoc: () => ({ stdout: '' }) });
    await assert.rejects(
      pandocRenderer({ execFile, env: {} }).render({
        input: { markdownPath: SAMPLE },
        output: { path: join(dir, 'out.html'), format: 'html' },
        cwd: dir,
      }),
      (err) => {
        assert.equal(err.code, 'EXECUTION');
        assert.match(err.message, /wrote no file/);
        return true;
      },
    );
  });
});

function latexWith(handlers, { pandocVersion = 'pandoc 3.6.4\n' } = {}) {
  const execFile = fakeExecFile({
    pandoc: async ({ args }) => {
      const out = argValue(args, '--output');
      if (out) await writeFile(out, '\\documentclass{article}\\begin{document}x\\end{document}');
      return { stdout: pandocVersion };
    },
    ...handlers,
  });
  const pandoc = pandocRenderer({ execFile, env: {} });
  return { execFile, renderer: latexRenderer({ execFile, env: {}, pandoc }) };
}

test('latex: renders pdf only, and reports the engine and pandoc behind it', async () => {
  const { renderer } = latexWith({
    latexmk: () => ({ stdout: 'Latexmk, John Collins. Version 4.83\n' }),
  });
  assert.deepEqual(renderer.formats, ['pdf']);
  const availability = await renderer.available();
  assert.equal(availability.ok, true);
  assert.match(availability.version, /latexmk 4\.83/);
  assert.match(availability.version, /pandoc 3\.6\.4/);
});

test('latex: without pandoc there is nothing to compile, and the hint says so', async () => {
  const { renderer } = latexWith(
    {
      pandoc: () => {
        throw enoent('pandoc');
      },
    },
    { pandocVersion: '' },
  );
  const availability = await renderer.available();
  assert.equal(availability.ok, false);
  assert.match(availability.hint, /install pandoc/);
});

test('latex: with pandoc but no TeX the hint names a TeX distribution', async () => {
  const { renderer } = latexWith({
    latexmk: () => {
      throw enoent('latexmk');
    },
    pdflatex: () => {
      throw enoent('pdflatex');
    },
  });
  const availability = await renderer.available();
  assert.equal(availability.ok, false);
  assert.match(availability.hint, /texlive|TeX/i);
});

test('latex: latexmk compiles the tex pandoc produced and the pdf lands at the output path', async () => {
  await withTempDir(async (dir) => {
    const { execFile, renderer } = latexWith({
      latexmk: async ({ args, options }) => {
        if (args.includes('-v')) return { stdout: 'Latexmk, John Collins. Version 4.83\n' };
        assert.ok(args.includes('-pdf'));
        assert.ok(args.includes('-interaction=nonstopmode'));
        await writeFile(join(options.cwd, 'manuscript.pdf'), '%PDF-1.5 from latexmk');
        return { stdout: '' };
      },
    });
    const before = execFile.calls.length;
    const result = await renderer.render({
      input: { markdownPath: SAMPLE, metadata: { date: '2026-09-07' } },
      output: { path: join(dir, 'out', 'manuscript.pdf'), format: 'pdf' },
      cwd: dir,
    });

    const pandocCall = execFile.calls.slice(before).find((c) => c.args.includes('--to'));
    const texPath = argValue(pandocCall.args, '--output');
    assert.match(texPath, /\.tex$/);
    assert.equal(argValue(pandocCall.args, '--to'), 'latex');
    assert.equal(result.path, join(dir, 'out', 'manuscript.pdf'));
    assert.equal(await readFile(result.path, 'utf8'), '%PDF-1.5 from latexmk');
  });
});

test('latex: without latexmk it falls back to pdflatex, twice', async () => {
  await withTempDir(async (dir) => {
    const { execFile, renderer } = latexWith({
      latexmk: () => {
        throw enoent('latexmk');
      },
      pdflatex: async ({ args, options }) => {
        if (args.includes('--version')) return { stdout: 'pdfTeX 3.141592653-2.6-1.40.25\n' };
        await writeFile(join(options.cwd, 'manuscript.pdf'), '%PDF-1.5 from pdflatex');
        return { stdout: '' };
      },
    });
    await renderer.render({
      input: { markdownPath: SAMPLE },
      output: { path: join(dir, 'manuscript.pdf'), format: 'pdf' },
      cwd: dir,
    });
    const passes = execFile.calls.filter(
      (c) => c.file === 'pdflatex' && !c.args.includes('--version'),
    );
    assert.equal(passes.length, 2);
  });
});

test('latex: a compile that produced no pdf is an EXECUTION error carrying the log tail', async () => {
  await withTempDir(async (dir) => {
    const { renderer } = latexWith({
      latexmk: ({ args }) =>
        args.includes('-v')
          ? { stdout: 'Latexmk, John Collins. Version 4.83\n' }
          : { stdout: '! Undefined control sequence.\nl.42 \\nosuchmacro\n' },
    });
    await assert.rejects(
      renderer.render({
        input: { markdownPath: SAMPLE },
        output: { path: join(dir, 'manuscript.pdf'), format: 'pdf' },
        cwd: dir,
      }),
      (err) => {
        assert.equal(err.code, 'EXECUTION');
        assert.match(err.message, /no PDF/);
        assert.ok(err.details.some((d) => /Undefined control sequence/.test(d)));
        return true;
      },
    );
  });
});

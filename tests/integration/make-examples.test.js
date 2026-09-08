import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES, generate } from '../../scripts/make-examples.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..', '..');
const EXAMPLES = join(REPO_ROOT, 'examples');

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}

async function snapshotTree(root) {
  const files = await listFiles(root);
  const rel = files.map((f) => f.slice(root.length + 1)).sort();
  const contents = {};
  for (const r of rel) contents[r] = await readFile(join(root, r), 'utf8');
  return { rel, contents };
}

for (const profile of PROFILES) {
  test(`make-examples: ${profile.name} regenerates byte-identically`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'phdude-examples-'));
    t.after(() => rm(root, { recursive: true, force: true }));

    await generate(profile.name, root);
    const first = await snapshotTree(root);

    await generate(profile.name, root);
    const second = await snapshotTree(root);

    assert.deepEqual(second.rel, first.rel);
    for (const r of first.rel) {
      assert.equal(second.contents[r], first.contents[r], `${r} differs between runs`);
    }
  });

  test(`make-examples: ${profile.name} matches the committed examples/${profile.name}`, async (t) => {
    const committedRoot = join(EXAMPLES, profile.name);
    await stat(committedRoot); // fails loudly if the example was never committed

    const root = await mkdtemp(join(tmpdir(), 'phdude-examples-'));
    t.after(() => rm(root, { recursive: true, force: true }));

    await generate(profile.name, root);
    const generated = await snapshotTree(root);
    const committed = await snapshotTree(committedRoot);

    // .phdude/cache/ is gitignored by the workspace's own .gitignore, so it is regenerated
    // locally but never committed; everything else must match exactly.
    const tracked = (files) => files.filter((r) => !r.startsWith('.phdude/cache/'));
    const generatedTracked = tracked(generated.rel);
    const committedTracked = tracked(committed.rel);

    assert.deepEqual(generatedTracked, committedTracked);
    for (const r of generatedTracked) {
      assert.equal(generated.contents[r], committed.contents[r], `${r} differs from committed`);
    }
  });
}

// A comment is prose, and prose may say "that is the policy's business" without the core knowing
// what a business school is. What would make the core field-aware is a field's name reaching the
// code - a branch, a lookup table, a default - so the check reads what is left once the comments
// are gone. `//` after a colon is a URL scheme, not a comment.
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n')
    .toLowerCase();
}

// PRD §120 (Field Generality) and spec §2.3: the examples are the proof, and this is the
// invariant they prove. A field lives in a pack under packs/fields/ and in an example workspace
// under examples/; the moment its name reaches src/, the core has learned which discipline it is
// serving, and the next field needs a core change before it can be supported.
test('make-examples: the core never names a field', async () => {
  const fields = (await readdir(join(REPO_ROOT, 'packs', 'fields'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  // A discipline can be named without naming a pack, so the three example workspaces and the
  // phrases they are about are checked alongside the pack directories.
  const disciplines = ['machine learning', 'social science', 'social-science'];
  const forbidden = [...new Set([...fields, ...disciplines, ...PROFILES.map((p) => p.name)])];

  const sources = (await listFiles(join(REPO_ROOT, 'src'))).filter((f) => f.endsWith('.js'));
  assert.ok(sources.length > 0, 'src/ should contain modules to check');

  const offenders = [];
  for (const file of sources) {
    const text = code(await readFile(file, 'utf8'));
    for (const name of forbidden) {
      if (text.includes(name)) offenders.push(`${file.slice(REPO_ROOT.length + 1)}: ${name}`);
    }
  }

  assert.deepEqual(offenders, [], 'src/ must not name a research field');
});

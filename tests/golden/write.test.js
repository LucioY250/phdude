import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { assignBibkeys } from '../../src/domain/bibkey.js';
import { assembleContext } from '../../src/domain/context-budget.js';
import { loadSnapshot } from '../../src/application/snapshot.js';

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(here, '..', '..', 'examples', 'generic-thesis');
const FIXED_NOW = () => '2026-09-07T12:00:00Z';
const GOLDEN = join(here, 'expected', 'write-context.md');

// A budget the example fits inside, fixed so the golden describes the priority order rather
// than the size of whatever the example happens to hold today.
const BUDGET = 4000;

test('write golden: the introduction context on examples/generic-thesis is byte-stable', async () => {
  const store = new FsStore(WORKSPACE);
  const snapshot = await loadSnapshot(store, FIXED_NOW);
  const policy = await store.readYaml(join('.phdude', 'writing-policy.yaml'));
  // The same two files `write()` reads for the manuscript's active voice, so the golden is what
  // a researcher running `phdude write introduction` on the example actually gets.
  const profile = await store.readYaml(join('authors', `${snapshot.manuscript.voice.author}.yaml`));
  const context = assembleContext(snapshot, 'introduction', {
    profile,
    policy,
    budgetChars: BUDGET,
    bibkeys: assignBibkeys(snapshot.sources),
  });

  if (process.env.UPDATE_GOLDEN) {
    await writeFile(GOLDEN, context.markdown);
    return;
  }

  assert.equal(context.markdown, await readFile(GOLDEN, 'utf8'));
});

test('write golden: the introduction context carries the claim, its evidence and its verbs', async () => {
  const store = new FsStore(WORKSPACE);
  const snapshot = await loadSnapshot(store, FIXED_NOW);
  const context = assembleContext(snapshot, 'introduction', {
    budgetChars: BUDGET,
    bibkeys: assignBibkeys(snapshot.sources),
  });

  assert.deepEqual(
    context.included.map((item) => item.kind),
    ['instruction', 'facts', 'claim', 'bibkeys', 'policy', 'voice', 'epistemic'],
    'every priority band of PRD §70 is represented',
  );
  assert.deepEqual(context.truncated, [], `${BUDGET} characters is enough for the example`);
  assert.ok(context.markdown.includes('Purpose: Establish the problem'));
  assert.ok(context.markdown.includes('| supported |'), 'the verb table names the states present');
});

test('write golden: a tight budget drops the lowest-priority items and says which', async () => {
  const store = new FsStore(WORKSPACE);
  const snapshot = await loadSnapshot(store, FIXED_NOW);
  const bibkeys = assignBibkeys(snapshot.sources);
  const full = assembleContext(snapshot, 'introduction', { budgetChars: BUDGET, bibkeys });

  // Exactly enough for the first three priority bands, and one character short of the fourth.
  const upToClaim = full.included.slice(0, 3).reduce((sum, item) => sum + item.chars, 0);
  const tight = assembleContext(snapshot, 'introduction', { budgetChars: upToClaim, bibkeys });

  assert.deepEqual(
    tight.included.map((item) => item.kind),
    ['instruction', 'facts', 'claim'],
  );
  assert.deepEqual(
    tight.truncated.map((item) => item.kind),
    ['bibkeys', 'policy', 'voice', 'epistemic'],
  );
});

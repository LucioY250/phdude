import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES } from '../../scripts/make-examples.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'phdude.js');
const ACTOR = ['--actor', 'researcher=tester,agent=e2e'];

// The committed example workspaces, named rather than globbed: examples/ also holds directories
// that are not workspaces (extension samples), and a sweep over all of them would run `status`
// against a directory that was never meant to answer.
const WORKSPACES = ['generic-thesis', ...PROFILES.map((profile) => profile.name)];

const DIMENSIONS = [
  'Literature Coverage',
  'Evidence Strength',
  'Methodological Integrity',
  'Citation Quality',
  'Freshness',
  'Reproducibility',
  'Consistency',
  'Academic Prose Quality',
];

function phdude(cwd, args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args, ...ACTOR],
      { cwd, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

// A copy, not the committed workspace: these commands are read-only, and running them against a
// throwaway copy is how the suite proves it rather than assuming it.
async function copyOf(name, t) {
  const dir = await mkdtemp(join(tmpdir(), 'phdude-example-e2e-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ws = join(dir, name);
  await cp(join(REPO_ROOT, 'examples', name), ws, { recursive: true });
  return ws;
}

for (const name of WORKSPACES) {
  test(`e2e examples: ${name} answers status, health and ready`, async (t) => {
    const ws = await copyOf(name, t);

    const status = await phdude(ws, ['status']);
    assert.equal(status.code, 0, `phdude status failed on ${name}:\n${status.stderr}`);
    assert.match(status.stdout, /^Project: /);

    const health = await phdude(ws, ['health']);
    assert.equal(health.code, 0, `phdude health failed on ${name}:\n${health.stderr}`);
    for (const dimension of DIMENSIONS) {
      assert.ok(health.stdout.includes(dimension), `${name}: health omits ${dimension}`);
    }

    // `ready` is the one command here that answers with its exit code: 0 when the workspace
    // could be submitted, 2 when something blocks it. Any other code is a crash wearing a
    // verdict's clothes, and the same workspace must not answer differently twice.
    const ready = await phdude(ws, ['ready']);
    assert.ok([0, 2].includes(ready.code), `${name}: ready exited ${ready.code}\n${ready.stderr}`);
    const again = await phdude(ws, ['ready']);
    assert.equal(again.code, ready.code, `${name}: ready is not deterministic`);
    assert.equal(again.stdout, ready.stdout);
  });

  test(`e2e examples: ${name} reports gaps and a next action as JSON`, async (t) => {
    const ws = await copyOf(name, t);

    const gaps = await phdude(ws, ['gaps', '--json']);
    assert.equal(gaps.code, 0, `phdude gaps failed on ${name}:\n${gaps.stderr}`);
    const report = JSON.parse(gaps.stdout);
    assert.ok(Array.isArray(report.gaps));

    const next = await phdude(ws, ['next', '--json']);
    assert.equal(next.code, 0, `phdude next failed on ${name}:\n${next.stderr}`);
    const recommendation = JSON.parse(next.stdout);
    assert.ok(recommendation.top, `${name}: next recommends nothing`);
    assert.match(recommendation.top.command, /^phdude /);
  });
}

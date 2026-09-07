import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMigrations } from '../../../src/application/migrate.js';
import { PhdudeError } from '../../../src/domain/errors.js';

async function tempMigrationsDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'phdude-migrations-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('loadMigrations returns [] when the migrations directory does not exist', async () => {
  const steps = await loadMigrations('/nonexistent/phdude-migrations-dir');
  assert.deepEqual(steps, []);
});

test('loadMigrations loads a well-formed migration module', async (t) => {
  const dir = await tempMigrationsDir(t);
  await writeFile(
    join(dir, '0001-ok.mjs'),
    [
      'export default {',
      '  from: 1,',
      '  to: 2,',
      "  describe: () => 'ok',",
      '  async preview() { return []; },',
      '  async apply() { return { changed: [] }; },',
      '};',
    ].join('\n'),
  );
  const steps = await loadMigrations(dir);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].from, 1);
  assert.equal(steps[0].to, 2);
});

for (const [label, body] of [
  [
    'missing to',
    "export default { from: 1, describe: () => 'x', async preview() {}, async apply() {} };",
  ],
  [
    'non-integer from',
    "export default { from: 'one', to: 2, describe: () => 'x', async preview() {}, async apply() {} };",
  ],
  ['missing describe', 'export default { from: 1, to: 2, async preview() {}, async apply() {} };'],
  ['missing preview', "export default { from: 1, to: 2, describe: () => 'x', async apply() {} };"],
  ['missing apply', "export default { from: 1, to: 2, describe: () => 'x', async preview() {} };"],
  ['no default export', 'export const notDefault = { from: 1, to: 2 };'],
]) {
  test(`loadMigrations rejects a malformed migration module: ${label}`, async (t) => {
    const dir = await tempMigrationsDir(t);
    await writeFile(join(dir, '0001-bad.mjs'), body);

    await assert.rejects(
      () => loadMigrations(dir),
      (err) => {
        assert.ok(err instanceof PhdudeError);
        assert.equal(err.code, 'VALIDATION');
        assert.match(err.message, /malformed migration module 0001-bad\.mjs/);
        assert.equal(err.hint, 'reinstall phdude; its migrations directory is corrupt');
        return true;
      },
    );
  });
}

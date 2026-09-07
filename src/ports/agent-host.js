import { join } from 'node:path';

/**
 * @typedef {object} AgentHost
 * @property {string} name
 * @property {(root: string, opts: { project: object, skillsDir?: string, commandsDir?: string }) => Promise<{ written: string[], skipped: string[] }>} install
 */

/**
 * Registers node:test cases every AgentHost implementation must satisfy.
 * @param {typeof import('node:test').test} test
 * @param {typeof import('node:assert/strict')} assert
 * @param {{ mkdtemp: () => Promise<string>, readFile: (p: string, enc: string) => Promise<string> }} io
 * @param {AgentHost} host
 */
export function agentHostContract(test, assert, { mkdtemp, readFile }, host) {
  test(`${host.name}: name matches /^[a-z-]+$/`, () => {
    assert.match(host.name, /^[a-z-]+$/);
  });

  test(`${host.name}: install writes at least one file`, async () => {
    const root = await mkdtemp();
    const { written } = await host.install(root, { project: { title: 'Contract test' } });
    assert.ok(written.length >= 1);
  });

  test(`${host.name}: every written file mentions phdude`, async () => {
    const root = await mkdtemp();
    const { written } = await host.install(root, { project: { title: 'Contract test' } });
    for (const rel of written) {
      const text = await readFile(join(root, rel), 'utf8');
      assert.match(text.toLowerCase(), /phdude/, `${rel} should mention phdude`);
    }
  });

  test(`${host.name}: install is idempotent`, async () => {
    const root = await mkdtemp();
    const r1 = await host.install(root, { project: { title: 'Contract test' } });
    const before = {};
    for (const rel of r1.written) before[rel] = await readFile(join(root, rel), 'utf8');

    const r2 = await host.install(root, { project: { title: 'Contract test' } });
    assert.equal(r2.written.length, 0);
    assert.deepEqual([...r2.skipped].sort(), [...r1.written].sort());
    for (const rel of r1.written) {
      assert.equal(await readFile(join(root, rel), 'utf8'), before[rel]);
    }
  });
}

/**
 * @typedef {object} ParseResult
 * @property {string} text
 * @property {{title: string, text: string}[]} sections
 * @property {{name: string, rows: string[][]}[]} tables
 * @property {object} meta
 * @property {string[]} warnings
 */

/**
 * @typedef {object} DocumentParser
 * @property {string} name
 * @property {string[]} kinds
 * @property {() => Promise<boolean>} available
 * @property {(buffer: Buffer, opts: { path: string }) => Promise<ParseResult>} parse
 */

/**
 * Registers node:test cases every DocumentParser implementation must satisfy.
 * @param {typeof import('node:test').test} test
 * @param {typeof import('node:assert/strict')} assert
 * @param {DocumentParser} parser
 * @param {[string, Promise<Buffer>|Buffer][]} fixtures
 */
export function documentParserContract(test, assert, parser, fixtures) {
  for (const [name, bufferOrPromise] of fixtures) {
    test(`${parser.name}: ${name} parses into a well-shaped ParseResult`, async () => {
      const buffer = await bufferOrPromise;
      const result = await parser.parse(buffer, { path: name });
      assert.equal(typeof result.text, 'string');
      assert.ok(Array.isArray(result.sections));
      assert.ok(Array.isArray(result.tables));
      assert.ok(Array.isArray(result.warnings));
      assert.equal(typeof result.meta, 'object');
    });

    test(`${parser.name}: ${name} parse is idempotent`, async () => {
      const buffer = await bufferOrPromise;
      const r1 = await parser.parse(buffer, { path: name });
      const r2 = await parser.parse(buffer, { path: name });
      assert.deepEqual(r1, r2);
    });
  }

  test(`${parser.name}: empty buffer does not throw`, async () => {
    const result = await parser.parse(Buffer.alloc(0), { path: 'empty' });
    assert.equal(typeof result.text, 'string');
    assert.ok(Array.isArray(result.sections));
    assert.ok(Array.isArray(result.tables));
    assert.ok(Array.isArray(result.warnings));
  });
}

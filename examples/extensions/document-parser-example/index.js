// SPDX-License-Identifier: MIT
//
// An example third-party PhDude DocumentParser. It reads a plain-text note: the first non-empty
// line is the title, everything after it is the body, and the pair becomes one section. Nothing
// here imports PhDude.
//
// See docs/extension-api.md#documentparser for the contract this satisfies.

const NAME = 'example-text';

export const exampleParser = {
  name: NAME,
  kinds: ['txt'],

  // Nothing to probe: this parser needs no external tool, so it is always available.
  async available() {
    return true;
  },

  /**
   * Parsing is pure and idempotent: the same bytes always yield the same result, and an empty
   * buffer is a document with nothing in it rather than an error.
   * @param {Buffer|Uint8Array} buffer
   * @param {{path?: string}} opts
   * @returns {Promise<{text: string, sections: {title: string, text: string}[],
   *   tables: {name: string, rows: string[][]}[], meta: object, warnings: string[]}>}
   */
  async parse(buffer, { path = '' } = {}) {
    const content = Buffer.from(buffer).toString('utf8');
    const lines = content.split(/\r?\n/);
    const titleAt = lines.findIndex((line) => line.trim() !== '');

    if (titleAt === -1) {
      return {
        text: content,
        sections: [],
        tables: [],
        meta: { kind: 'txt', title: null },
        warnings: [`${NAME}: ${path || 'the file'} carried no text`],
      };
    }

    const title = lines[titleAt].trim();
    return {
      text: content,
      sections: [{ title, text: lines.slice(titleAt + 1).join('\n').trim() }],
      tables: [],
      meta: { kind: 'txt', title },
      warnings: [],
    };
  },
};

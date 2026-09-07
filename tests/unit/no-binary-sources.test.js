import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIRS = ['src', 'tests'];

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

test('no .js source or test file contains a NUL byte', () => {
  for (const dir of DIRS) {
    for (const file of walk(dir)) {
      const buf = readFileSync(file);
      assert.ok(!buf.includes(0), `${file} contains a NUL byte`);
    }
  }
});

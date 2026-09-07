import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = {
  'src/domain': [
    /from '\.\.\/(application|ports|adapters)/,
    /from 'node:(fs|child_process|os)/,
    /from '(yaml|ajv|fflate)'/,
  ],
  'src/application': [/from '\.\.\/adapters/],
};
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}
for (const [dir, patterns] of Object.entries(FORBIDDEN)) {
  test(`${dir} respects layering`, () => {
    for (const file of walk(dir)) {
      const src = readFileSync(file, 'utf8');
      for (const re of patterns) assert.ok(!re.test(src), `${file} violates layering: ${re}`);
    }
  });
}

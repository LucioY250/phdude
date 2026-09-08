import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, OUT_FILE, TIMING, PROMPT_Y } from '../../scripts/make-demo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..', '..');
const COMMITTED = join(REPO_ROOT, 'docs', 'assets', 'demo.svg');

// The demo is the first thing a reader sees, and every frame in it is real command output. A
// committed file that no longer matches a fresh run is a demo that has started lying, so it is
// held to the same byte parity as the example workspaces and the golden reports.
test('make-demo: the committed demo.svg is what a fresh run writes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'phdude-demo-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const out = join(dir, 'demo.svg');
  await generate(out);

  assert.equal(
    await readFile(out, 'utf8'),
    await readFile(COMMITTED, 'utf8'),
    'docs/assets/demo.svg is out of date; run npm run demo and commit the result',
  );
  assert.equal(OUT_FILE, COMMITTED);
});

// Byte parity only holds if nothing in the render reads the clock or invents a name. The
// generator runs the CLI, which has both a clock and an id generator within reach.
test('make-demo: the SVG carries no timestamp and no generated id', async () => {
  const svg = await readFile(COMMITTED, 'utf8');
  assert.equal(svg.match(/\d{4}-\d{2}-\d{2}T?\d{0,2}:?\d{0,2}/g), null, 'the SVG carries a date');
  assert.equal(svg.match(/\bid="/g), null, 'the SVG carries an id');
  assert.equal(svg.match(/<script/gi), null, 'the SVG carries a script');
});

// Reads every `<text y="…">…<animate values="…" keyTimes="…">` in the file, so the loop can be
// evaluated at a given moment without a renderer.
function timeline(svg) {
  const elements = [];
  const re =
    /<text x="[\d.]+" y="([\d.]+)"[^>]*>.*?<animate attributeName="opacity" values="([^"]+)" keyTimes="([^"]+)"/g;
  for (const [, y, values, keyTimes] of svg.matchAll(re)) {
    elements.push({
      y: Number(y),
      values: values.split(';').map(Number),
      keyTimes: keyTimes.split(';').map(Number),
    });
  }
  return elements;
}

function visibleAt(element, fraction) {
  let value = 0;
  for (let i = 0; i < element.keyTimes.length; i++) {
    if (element.keyTimes[i] <= fraction) value = element.values[i];
    else break;
  }
  return value === 1;
}

// There is no way to render SMIL here, so the loop is checked as arithmetic: a terminal shows one
// command line at a time, and the demo is only readable if that stays true at every moment of it.
test('make-demo: exactly one prompt line is on screen once a command starts typing', async () => {
  const elements = timeline(await readFile(COMMITTED, 'utf8'));
  const prompts = elements.filter((e) => e.y === PROMPT_Y);
  assert.ok(prompts.length > 6, 'the typing frames are missing');

  // keyTimes are rounded to four decimals, so a sample landing exactly on a transition - the top
  // of a slot, or the moment typing starts - can fall either side of it. Those two 20 ms bands
  // are skipped; every other moment of the loop is exact.
  const near = (a, b) => Math.abs(a - b) < 0.02;
  for (let t = 0; t < TIMING.loop; t += 0.05) {
    const intoSlot = t % TIMING.slot;
    if (near(intoSlot, 0) || near(intoSlot, TIMING.slot) || near(intoSlot, TIMING.typeStart)) {
      continue;
    }
    const lit = prompts.filter((p) => visibleAt(p, t / TIMING.loop)).length;
    const expected = intoSlot > TIMING.typeStart ? 1 : 0;
    assert.equal(lit, expected, `${lit} prompt line(s) at ${t.toFixed(2)}s, expected ${expected}`);
  }
});

test('make-demo: every command gets its output on screen, and clears it before the next', async () => {
  const elements = timeline(await readFile(COMMITTED, 'utf8'));
  const output = elements.filter((e) => e.y > PROMPT_Y);
  assert.ok(output.length > 0, 'no output lines were rendered');

  for (let frame = 0; frame < TIMING.frames; frame++) {
    const dwell = (frame * TIMING.slot + TIMING.slot - 0.4) / TIMING.loop;
    const lit = output.filter((line) => visibleAt(line, dwell));
    assert.ok(lit.length >= 3, `frame ${frame} shows only ${lit.length} output line(s)`);

    // A row that is still lit while the next command types is a row from the previous screen.
    const handover = (frame * TIMING.slot + TIMING.slot + 0.1) / TIMING.loop;
    if (frame < TIMING.frames - 1) {
      const stale = output.filter((line) => lit.includes(line) && visibleAt(line, handover));
      assert.deepEqual(stale, [], `frame ${frame} leaves output on screen for the next command`);
    }
  }
});

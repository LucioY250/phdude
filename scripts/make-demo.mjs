#!/usr/bin/env node
// Generates the animated terminal demo the README shows: docs/assets/demo.svg.
// Every frame is real output: the six commands run against a throwaway copy of
// examples/generic-thesis with this repository's own binary, so the demo cannot drift from what
// PhDude actually prints. Nothing here reads the clock or invents an id, so the SVG is
// byte-identical between runs and tests/integration/make-demo.test.js can compare it.
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'phdude.js');
const WORKSPACE = join(ROOT, 'examples', 'generic-thesis');
export const OUT_FILE = join(ROOT, 'docs', 'assets', 'demo.svg');

// The six that answer "what would I actually type?": where the project stands, what to do next,
// what the literature search turned up, how the manuscript is coming, how healthy it is, and
// whether it could go out. `research list` reads candidates already on disk, so nothing here
// touches the network.
export const COMMANDS = [
  ['status'],
  ['next'],
  ['research', 'list', '--state', 'candidate'],
  ['manuscript', 'status'],
  ['health'],
  ['ready'],
];

// Terminal geometry. COLS is what fits inside the frame at FONT_SIZE in any of the monospace
// faces the stack falls back through, so a wrapped line never runs past the right edge.
const W = 900;
const BAR_H = 36;
const PAD_X = 22;
const TOP = BAR_H + 26;
const LINE_H = 19;
const FONT_SIZE = 13;
const COLS = 102;
const MAX_OUT = 18;
const ROWS = 2 + MAX_OUT + 1; // the prompt, a blank line, the output, the trim marker
const H = TOP + (ROWS - 1) * LINE_H + 18;

// One slot per command: ~1.4 s of typing, then ~4 s with the output on screen.
const SLOT = 5.8;
const TYPE_START = 0.35;
const TYPE_TOTAL = 1.05;
const OUT_DELAY = 0.3;
const BLINK_ON = 0.55;
const BLINK_OFF = 0.45;
const T = SLOT * COMMANDS.length;

// What a test needs to know to check the loop without rendering it.
export const TIMING = { slot: SLOT, typeStart: TYPE_START, loop: T, frames: COMMANDS.length };

const FONT =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace";

// Dark terminal ground, with the green the hand-drawn diagrams already use as the accent.
const C = {
  page: '#0f1115',
  ground: '#16181d',
  bar: '#22252c',
  edge: '#2c3038',
  green: '#b2f2bb',
  yellow: '#ffec99',
  red: '#ffc9c9',
  text: '#c8cdd4',
  bright: '#e9ecef',
  muted: '#7c848f',
};

const CURSOR = '█';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Four decimals is finer than any renderer's timing resolution and keeps the bytes stable.
const fmt = (n) => n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function wrap(line) {
  if (line.length <= COLS) return [line];
  const out = [];
  for (let i = 0; i < line.length; i += COLS) out.push(line.slice(i, i + COLS));
  return out;
}

function trim(lines) {
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length <= MAX_OUT) return { lines, hidden: 0 };
  return { lines: lines.slice(0, MAX_OUT), hidden: lines.length - MAX_OUT };
}

// Runs one command and returns what a terminal would show: ANSI stripped, hard-wrapped at the
// frame width, cut to MAX_OUT lines with a note saying how many were left off.
function run(cwd, args) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.error) throw result.error;
  const raw = `${result.stdout}${result.stderr}`.replace(ANSI, '').replace(/\r\n/g, '\n');
  const wrapped = raw.split('\n').flatMap(wrap);
  const { lines, hidden } = trim(wrapped);
  if (hidden > 0) lines.push(`… ${hidden} more line${hidden === 1 ? '' : 's'}`);
  return { command: `phdude ${args.join(' ')}`, lines };
}

export async function capture() {
  const dir = await mkdtemp(join(tmpdir(), 'phdude-demo-'));
  try {
    const workspace = join(dir, 'generic-thesis');
    await cp(WORKSPACE, workspace, { recursive: true });
    return COMMANDS.map((args) => run(workspace, args));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// An element that is on for each [from, to) window of the loop and off the rest of the time.
// Discrete steps on opacity only: no scripts, and nothing GitHub's SVG sanitizer strips.
function steps(windows) {
  const values = ['0'];
  const times = [0];
  for (const [from, to] of windows) {
    values.push('1');
    times.push(from / T);
    values.push('0');
    times.push(to / T);
  }
  if (times[times.length - 1] < 1) {
    values.push('0');
    times.push(1);
  }
  return `<animate attributeName="opacity" values="${values.join(';')}" keyTimes="${times
    .map(fmt)
    .join(';')}" calcMode="discrete" dur="${fmt(T)}s" repeatCount="indefinite"/>`;
}

// `content` is markup, already escaped: the prompt lines carry a coloured `$` inside a tspan.
function el(row, content, fill, windows) {
  const y = TOP + row * LINE_H;
  return `<text x="${PAD_X}" y="${y}" fill="${fill}" opacity="0">${content}${steps(windows)}</text>`;
}

// The prompt sits on the green the diagrams use, so the demo and the diagrams read as one set.
const prompt = (rest) => `<tspan fill="${C.green}">$</tspan> ${esc(rest)}`;

// The prompt types itself: one text element per prefix of the command, each on for its own step,
// with a block cursor riding along and blinking once the line is finished.
function promptFrames(row, command, t0) {
  const parts = [];
  const chars = [...command];
  const step = TYPE_TOTAL / chars.length;
  const typedEnd = t0 + TYPE_START + TYPE_TOTAL;
  const slotEnd = t0 + SLOT;

  for (let k = 0; k < chars.length - 1; k++) {
    const from = t0 + TYPE_START + k * step;
    parts.push(
      el(row, prompt(`${chars.slice(0, k + 1).join('')}${CURSOR}`), C.bright, [
        [from, from + step],
      ]),
    );
  }

  const on = [[t0 + TYPE_START + (chars.length - 1) * step, typedEnd + BLINK_ON]];
  const off = [];
  for (let t = typedEnd + BLINK_ON; t < slotEnd; t += BLINK_ON + BLINK_OFF) {
    off.push([t, Math.min(t + BLINK_OFF, slotEnd)]);
    const next = t + BLINK_OFF;
    if (next < slotEnd) on.push([next, Math.min(next + BLINK_ON, slotEnd)]);
  }
  parts.push(el(row, prompt(`${command}${CURSOR}`), C.bright, on));
  parts.push(el(row, prompt(command), C.bright, off));
  return parts;
}

export const PROMPT_Y = TOP;

export function renderSvg(frames) {
  const alt =
    'A terminal running six PhDude commands in turn - status, next, research list, manuscript status, health and ready - each printing its real output.';
  const desc =
    'An animated terminal recording. Six commands are typed one after another against the example thesis workspace that ships with PhDude. ' +
    frames
      .map((f) => `${f.command} prints ${f.lines.length} line${f.lines.length === 1 ? '' : 's'}`)
      .join('; ') +
    '. The same output is in docs/guide.md as text.';

  const body = [];
  frames.forEach((frame, i) => {
    const t0 = i * SLOT;
    const slotEnd = t0 + SLOT;
    body.push(...promptFrames(0, frame.command, t0));

    const outStart = t0 + TYPE_START + TYPE_TOTAL + OUT_DELAY;
    const stagger = Math.min(0.03, 0.36 / Math.max(frame.lines.length, 1));
    frame.lines.forEach((text, n) => {
      const from = outStart + n * stagger;
      const dim = text.startsWith('… ') && n === frame.lines.length - 1;
      body.push(el(n + 2, esc(text), dim ? C.muted : C.text, [[from, slotEnd]]));
    });
  });

  const dots = [C.red, C.yellow, C.green]
    .map((fill, i) => `<circle cx="${PAD_X + i * 18}" cy="${BAR_H / 2}" r="5.5" fill="${fill}"/>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(alt)}">
<title>${esc(alt)}</title>
<desc>${esc(desc)}</desc>
<rect width="${W}" height="${H}" rx="10" fill="${C.page}"/>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="9" fill="${C.ground}" stroke="${C.edge}" stroke-width="1"/>
<path d="M1 ${BAR_H}h${W - 2}" stroke="${C.edge}" stroke-width="1"/>
${dots}
<text x="${W / 2}" y="${BAR_H / 2 + 4}" fill="${C.muted}" font-family="${FONT}" font-size="11.5" text-anchor="middle">phdude — examples/generic-thesis</text>
<g font-family="${FONT}" font-size="${FONT_SIZE}" xml:space="preserve">
${body.join('\n')}
</g>
</svg>
`;
}

export async function generate(outFile = OUT_FILE) {
  const svg = renderSvg(await capture());
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, svg);
  return outFile;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = await generate();
  console.log(`wrote ${file.slice(ROOT.length + 1)}`);
}

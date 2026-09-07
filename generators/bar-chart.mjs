#!/usr/bin/env node
// The figure generator PhDude ships, so a workspace can build one accessible, reproducible
// chart without installing anything (spec §3.5). It is deliberately small: plain Node, no
// dependencies, no network, no fonts to fetch, and the same bytes out for the same bytes in.
//
//   node generators/bar-chart.mjs --input <results.json|dataset.csv> --key <result key|column> \
//     --out <figures/out/name.svg> --title "<title>" --alt "<what the figure shows>"
//
// It is run through `phdude figure build`, which resolves it, hashes its output and records the
// run. Nothing here reads the workspace's records; the input file is the whole contract.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { parseArgs } from 'node:util';

const WIDTH = 720;
const HEIGHT = 420;
const MARGIN = { top: 56, right: 24, bottom: 88, left: 72 };
const PLOT = {
  x: MARGIN.left,
  y: MARGIN.top,
  width: WIDTH - MARGIN.left - MARGIN.right,
  height: HEIGHT - MARGIN.top - MARGIN.bottom,
};
const BAR_FILL = 0.6;
const TICKS = 4;
const MAX_BARS = 40;

// One hue for every bar: the category is already encoded by the axis, so colouring each bar
// differently would add a second encoding of the same thing and cost a reader who cannot tell
// the hues apart. Okabe-Ito blue on white clears 4.5:1, and every label is real text.
const INK = '#1a1a1a';
const BAR = '#0072b2';
const AXIS = '#767676';
const GRID = '#d9d9d9';
const PAPER = '#ffffff';
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function fail(message) {
  process.stderr.write(`bar-chart: ${message}\n`);
  process.exit(1);
}

// Paths come from a record a researcher edits, and this runs with the workspace as its working
// directory, so a path that leaves the workspace is refused rather than resolved.
function insideWorkspace(value, label) {
  const text = String(value ?? '').trim();
  if (text === '' || isAbsolute(text)) fail(`${label} must be a path inside the workspace`);
  const rel = normalize(text).split(sep).join('/');
  if (rel.split('/').includes('..')) fail(`${label} must be a path inside the workspace`);
  return rel;
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell !== ''));
}

function pairsOfValues(values, where) {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    fail(`${where} is not an object of label -> number`);
  }
  const pairs = Object.entries(values).map(([label, value]) => {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) fail(`${where}.${label} is not a number`);
    return { label, value: n };
  });
  if (pairs.length === 0) fail(`${where} has no values to plot`);
  return pairs;
}

// A results.json as the analysis contract defines it (spec §3.3), or a plain object whose
// `--key` member holds the label -> number pairs.
function seriesFromJson(text, key, input) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    fail(`${input} is not valid JSON: ${err.message}`);
  }

  if (Array.isArray(doc?.results)) {
    const hit = doc.results.find((r) => r?.key === key);
    if (!hit) {
      const keys = doc.results.map((r) => r?.key).filter(Boolean);
      fail(`${input} has no result with key "${key}" (keys: ${keys.join(', ') || 'none'})`);
    }
    const unit = typeof hit.unit === 'string' && hit.unit.trim() !== '' ? hit.unit.trim() : null;
    return {
      pairs: pairsOfValues(hit.values, `result ${key} values`),
      yLabel: unit ? `${key} (${unit})` : key,
      xLabel: null,
    };
  }

  if (doc !== null && typeof doc === 'object' && Object.hasOwn(doc, key)) {
    return { pairs: pairsOfValues(doc[key], `${key}`), yLabel: key, xLabel: null };
  }

  fail(`${input} has neither a results array nor a "${key}" member`);
}

// A dataset column: one bar per distinct value, its height the number of rows holding it, in
// the order the values first appear. The chart reports what is in the column; it does not
// reorder it into a ranking the file never had.
function seriesFromTable(text, key, input, delimiter) {
  const rows = parseDelimited(text, delimiter);
  if (rows.length < 2) fail(`${input} has no rows under its header`);
  const header = rows[0].map((cell, i) => (cell.trim() === '' ? `column_${i + 1}` : cell.trim()));
  const index = header.indexOf(key);
  if (index === -1) fail(`${input} has no column "${key}" (columns: ${header.join(', ')})`);

  const counts = new Map();
  for (const row of rows.slice(1)) {
    const value = String(row[index] ?? '').trim();
    if (value === '') continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  if (counts.size === 0) fail(`${input} column "${key}" has no values`);
  return {
    pairs: [...counts].map(([label, value]) => ({ label, value })),
    yLabel: 'count',
    xLabel: key,
  };
}

async function readSeries(input, key) {
  const readers = {
    '.json': (text) => seriesFromJson(text, key, input),
    '.tsv': (text) => seriesFromTable(text, key, input, '\t'),
    '.csv': (text) => seriesFromTable(text, key, input, ','),
  };
  const extension = Object.keys(readers).find((ext) => input.endsWith(ext));
  if (!extension) fail(`unsupported input ${input}: expected a .json, .csv or .tsv file`);

  let text;
  try {
    text = await readFile(input, 'utf8');
  } catch (err) {
    fail(`cannot read ${input}: ${err.code ?? err.message}`);
  }
  return readers[extension](text);
}

function niceStep(range) {
  const raw = range / TICKS;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5]) {
    if (raw <= m * magnitude) return Number((m * magnitude).toPrecision(2));
  }
  return Number((10 * magnitude).toPrecision(2));
}

function scaleFor(values) {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  if (high === low) return { low: 0, high: 1, step: 0.25 };
  const step = niceStep(high - low);
  return {
    low: Number((Math.floor(low / step) * step).toPrecision(12)),
    high: Number((Math.ceil(high / step) * step).toPrecision(12)),
    step,
  };
}

function ticksOf({ low, high, step }) {
  const ticks = [];
  for (let i = 0; low + i * step <= high + step / 1e6; i++) {
    ticks.push(Number((low + i * step).toPrecision(12)));
  }
  return ticks;
}

function num(value) {
  return String(Number(Number(value).toPrecision(12)));
}

function coord(value) {
  return String(Math.round(value * 100) / 100);
}

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

function xml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]);
}

function renderSvg({ title, alt, pairs, yLabel, xLabel }) {
  const scale = scaleFor(pairs.map((p) => p.value));
  const span = scale.high - scale.low;
  const y = (value) => PLOT.y + (PLOT.height * (scale.high - value)) / span;
  const slot = PLOT.width / pairs.length;
  const barWidth = slot * BAR_FILL;
  const baseline = y(0);

  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-labelledby="figure-title figure-desc" font-family="${FONT}">`,
    `<title id="figure-title">${xml(title)}</title>`,
    `<desc id="figure-desc">${xml(alt)}</desc>`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>`,
    `<text x="${WIDTH / 2}" y="30" text-anchor="middle" font-size="18" font-weight="600" fill="${INK}">${xml(title)}</text>`,
  ];

  for (const tick of ticksOf(scale)) {
    const ty = coord(y(tick));
    lines.push(
      `<line x1="${PLOT.x}" y1="${ty}" x2="${PLOT.x + PLOT.width}" y2="${ty}" stroke="${GRID}" stroke-width="1"/>`,
      `<text x="${PLOT.x - 10}" y="${ty}" text-anchor="end" dominant-baseline="middle" font-size="12" fill="${INK}">${xml(num(tick))}</text>`,
    );
  }

  lines.push(
    `<line x1="${PLOT.x}" y1="${coord(baseline)}" x2="${PLOT.x + PLOT.width}" y2="${coord(baseline)}" stroke="${AXIS}" stroke-width="1.5"/>`,
    `<line x1="${PLOT.x}" y1="${PLOT.y}" x2="${PLOT.x}" y2="${PLOT.y + PLOT.height}" stroke="${AXIS}" stroke-width="1.5"/>`,
  );

  pairs.forEach((pair, i) => {
    const centre = PLOT.x + slot * i + slot / 2;
    const top = Math.min(y(pair.value), baseline);
    const height = Math.abs(y(pair.value) - baseline);
    lines.push(
      `<rect x="${coord(centre - barWidth / 2)}" y="${coord(top)}" width="${coord(barWidth)}" height="${coord(height)}" fill="${BAR}"/>`,
      `<text x="${coord(centre)}" y="${coord(pair.value < 0 ? y(pair.value) + 16 : y(pair.value) - 7)}" text-anchor="middle" font-size="12" fill="${INK}">${xml(num(pair.value))}</text>`,
      `<text x="${coord(centre)}" y="${PLOT.y + PLOT.height + 16}" text-anchor="end" font-size="12" fill="${INK}" transform="rotate(-30 ${coord(centre)} ${PLOT.y + PLOT.height + 16})">${xml(pair.label)}</text>`,
    );
  });

  if (yLabel) {
    const cy = PLOT.y + PLOT.height / 2;
    lines.push(
      `<text x="20" y="${coord(cy)}" text-anchor="middle" font-size="13" fill="${INK}" transform="rotate(-90 20 ${coord(cy)})">${xml(yLabel)}</text>`,
    );
  }
  if (xLabel) {
    lines.push(
      `<text x="${PLOT.x + PLOT.width / 2}" y="${HEIGHT - 10}" text-anchor="middle" font-size="13" fill="${INK}">${xml(xLabel)}</text>`,
    );
  }

  lines.push('</svg>');
  return lines.join('\n') + '\n';
}

const OPTIONS = {
  input: { type: 'string' },
  key: { type: 'string' },
  out: { type: 'string' },
  title: { type: 'string' },
  alt: { type: 'string' },
};

let values;
try {
  ({ values } = parseArgs({ args: process.argv.slice(2), options: OPTIONS, strict: true }));
} catch (err) {
  fail(`${err.message}\nusage: --input <file> --key <name> --out <file> --title <t> --alt <a>`);
}

for (const name of Object.keys(OPTIONS)) {
  if (String(values[name] ?? '').trim() === '') fail(`--${name} is required`);
}

const input = insideWorkspace(values.input, '--input');
const out = insideWorkspace(values.out, '--out');
const series = await readSeries(input, values.key);
if (series.pairs.length > MAX_BARS) {
  fail(`${input} would need ${series.pairs.length} bars; a readable bar chart holds ${MAX_BARS}`);
}

await mkdir(dirname(join('.', out)), { recursive: true });
await writeFile(out, renderSvg({ title: values.title, alt: values.alt, ...series }));
process.stdout.write(`${out}\n`);

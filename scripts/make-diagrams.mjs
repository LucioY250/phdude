#!/usr/bin/env node
// Generates the README diagrams in an Excalidraw-like hand-drawn style.
// Output per diagram: docs/assets/diagrams/<name>.svg (what the README embeds) and
// docs/assets/diagrams/<name>.excalidraw (open it on excalidraw.com to edit).
// Deterministic: the "hand-drawn" wobble comes from a seeded PRNG.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'assets', 'diagrams');
const FONT_PATH = join(ROOT, 'docs', 'assets', 'fonts', 'PatrickHand-subset.ttf');

const C = {
  ink: '#1e1e1e',
  blue: '#a5d8ff',
  green: '#b2f2bb',
  yellow: '#ffec99',
  red: '#ffc9c9',
  purple: '#d0bfff',
  orange: '#ffd8a8',
  gray: '#e9ecef',
  white: '#ffffff',
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// One slightly wobbly stroke between two points, drawn as a cubic curve.
function sketchLine(rnd, x1, y1, x2, y2, amp = 1.4) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const j = () => (rnd() - 0.5) * 2 * amp;
  const c1x = x1 + dx * 0.3 + nx * j();
  const c1y = y1 + dy * 0.3 + ny * j();
  const c2x = x1 + dx * 0.7 + nx * j();
  const c2y = y1 + dy * 0.7 + ny * j();
  return `M${(x1 + j() * 0.5).toFixed(1)} ${(y1 + j() * 0.5).toFixed(1)} C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${(x2 + j() * 0.5).toFixed(1)} ${(y2 + j() * 0.5).toFixed(1)}`;
}

function roughPoly(rnd, pts, { fill = 'none', stroke = C.ink, width = 1.6, dashed = false } = {}) {
  const fillPath =
    fill === 'none'
      ? ''
      : `<path d="M${pts.map((p) => `${p[0]} ${p[1]}`).join(' L')} Z" fill="${fill}" stroke="none"/>`;
  let d = '';
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      d += sketchLine(rnd, a[0], a[1], b[0], b[1]) + ' ';
    }
  }
  const dash = dashed ? ' stroke-dasharray="7 5"' : '';
  return `${fillPath}<path d="${d.trim()}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"${dash}/>`;
}

function roughRect(rnd, x, y, w, h, opts) {
  return roughPoly(
    rnd,
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    opts,
  );
}

function roughEllipse(rnd, cx, cy, rx, ry, { fill = 'none', stroke = C.ink, width = 1.6 } = {}) {
  const pts = [];
  const n = 28;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  let d = '';
  for (let pass = 0; pass < 2; pass++) {
    const r = 0.8;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      d += sketchLine(rnd, a[0], a[1], b[0], b[1], r) + ' ';
    }
  }
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="none"/><path d="${d.trim()}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
}

function roughDiamond(rnd, cx, cy, w, h, opts) {
  return roughPoly(
    rnd,
    [
      [cx, cy - h / 2],
      [cx + w / 2, cy],
      [cx, cy + h / 2],
      [cx - w / 2, cy],
    ],
    opts,
  );
}

function roughCylinder(rnd, x, y, w, h, { fill = C.gray } = {}) {
  const ry = 9;
  const body = `<path d="M${x} ${y + ry} L${x} ${y + h - ry} A${w / 2} ${ry} 0 0 0 ${x + w} ${y + h - ry} L${x + w} ${y + ry} A${w / 2} ${ry} 0 0 0 ${x} ${y + ry} Z" fill="${fill}" stroke="none"/>`;
  let d =
    sketchLine(rnd, x, y + ry, x, y + h - ry) +
    ' ' +
    sketchLine(rnd, x + w, y + ry, x + w, y + h - ry) +
    ' ';
  d +=
    sketchLine(rnd, x, y + ry, x, y + h - ry) +
    ' ' +
    sketchLine(rnd, x + w, y + ry, x + w, y + h - ry) +
    ' ';
  const top = `<ellipse cx="${x + w / 2}" cy="${y + ry}" rx="${w / 2}" ry="${ry}" fill="${fill}" stroke="${C.ink}" stroke-width="1.6"/>`;
  const bottom = `<path d="M${x} ${y + h - ry} A${w / 2} ${ry} 0 0 0 ${x + w} ${y + h - ry}" fill="none" stroke="${C.ink}" stroke-width="1.6"/>`;
  return `${body}<path d="${d.trim()}" fill="none" stroke="${C.ink}" stroke-width="1.6" stroke-linecap="round"/>${bottom}${top}`;
}

function textBlock(
  x,
  y,
  lines,
  { size = 17, anchor = 'middle', color = C.ink, bold = false } = {},
) {
  const lh = size * 1.2;
  const y0 = y - ((lines.length - 1) * lh) / 2;
  const weight = bold ? ' font-weight="bold"' : '';
  return lines
    .map(
      (l, i) =>
        `<text x="${x}" y="${(y0 + i * lh).toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="${size}" fill="${color}"${weight}>${esc(l)}</text>`,
    )
    .join('');
}

// Point where the segment from the node centre towards (tx,ty) leaves the node's box.
function borderPoint(n, tx, ty) {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (n.shape === 'ellipse') {
    const a = Math.atan2(dy, dx);
    return [cx + Math.cos(a) * (n.w / 2), cy + Math.sin(a) * (n.h / 2)];
  }
  if (n.shape === 'diamond') {
    const s = 1 / (Math.abs(dx) / (n.w / 2) + Math.abs(dy) / (n.h / 2) || 1);
    return [cx + dx * s, cy + dy * s];
  }
  const sx = dx === 0 ? Infinity : n.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : n.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

// Fixed attachment point on a node's side, for tidy fan-outs.
function sidePoint(n, side) {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  if (side === 'left') return [n.x, cy];
  if (side === 'right') return [n.x + n.w, cy];
  if (side === 'top') return [cx, n.y];
  if (side === 'bottom') return [cx, n.y + n.h];
  return null;
}

function arrow(rnd, from, to, { label, dashed = false, via, fromSide, toSide } = {}) {
  const pts = [];
  const fc = [from.x + from.w / 2, from.y + from.h / 2];
  const tc = [to.x + to.w / 2, to.y + to.h / 2];
  const first = via ? via[0] : tc;
  const last = via ? via[via.length - 1] : fc;
  pts.push(sidePoint(from, fromSide) ?? borderPoint(from, first[0], first[1]));
  if (via) pts.push(...via);
  pts.push(sidePoint(to, toSide) ?? borderPoint(to, last[0], last[1]));
  let d = '';
  for (let i = 0; i < pts.length - 1; i++)
    d += sketchLine(rnd, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 1.2) + ' ';
  const [ax, ay] = pts[pts.length - 1];
  const [bx, by] = pts[pts.length - 2];
  const ang = Math.atan2(ay - by, ax - bx);
  const hl = 11;
  const h1 = [ax - Math.cos(ang - 0.45) * hl, ay - Math.sin(ang - 0.45) * hl];
  const h2 = [ax - Math.cos(ang + 0.45) * hl, ay - Math.sin(ang + 0.45) * hl];
  d +=
    sketchLine(rnd, ax, ay, h1[0], h1[1], 0.6) + ' ' + sketchLine(rnd, ax, ay, h2[0], h2[1], 0.6);
  const dash = dashed ? ' stroke-dasharray="7 5"' : '';
  let out = '';
  if (label) {
    // Label sits just above (or beside, for steep lines) the segment's midpoint, drawn under the
    // arrow so the shaft stays visible.
    const i = Math.floor((pts.length - 1) / 2);
    const [m1, m2] = [pts[i], pts[i + 1]];
    const mx = (m1[0] + m2[0]) / 2;
    const my = (m1[1] + m2[1]) / 2;
    const steep = Math.abs(m2[1] - m1[1]) > Math.abs(m2[0] - m1[0]);
    const lines = label.split('\n');
    const w = Math.max(...lines.map((l) => l.length)) * 6.6 + 12;
    const h = lines.length * 16 + 4;
    const lx = steep ? mx + w / 2 + 8 : mx;
    const ly = steep ? my : my - h / 2 - 5;
    out += `<rect x="${(lx - w / 2).toFixed(1)}" y="${(ly - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="4" fill="${C.white}" fill-opacity="0.9"/>`;
    out += textBlock(lx, ly, lines, { size: 14, color: '#495057' });
  }
  out += `<path d="${d.trim()}" fill="none" stroke="${C.ink}" stroke-width="1.6" stroke-linecap="round"${dash}/>`;
  return out;
}

function renderSvg(scene, fontData) {
  const rnd = mulberry32(scene.seed ?? 7);
  const { width: W, height: H } = scene;
  const parts = [];
  parts.push(
    `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="${C.white}" stroke="#dee2e6" stroke-width="1"/>`,
  );
  if (scene.title)
    parts.push(textBlock(20, 26, [scene.title], { size: 15, anchor: 'start', color: '#868e96' }));
  for (const g of scene.groups ?? []) {
    parts.push(
      roughRect(rnd, g.x, g.y, g.w, g.h, {
        fill: g.fill ?? C.gray,
        dashed: g.dashed ?? false,
        width: 1.3,
      }),
    );
    parts.push(
      textBlock(g.x + 12, g.y + 16, [g.label], {
        size: 15,
        anchor: 'start',
        color: '#495057',
        bold: true,
      }),
    );
    if (g.note)
      parts.push(
        textBlock(g.x + g.w - 12, g.y + 16, [g.note], {
          size: 13,
          anchor: 'end',
          color: '#868e96',
        }),
      );
  }
  const byId = Object.fromEntries(scene.nodes.map((n) => [n.id, n]));
  for (const n of scene.nodes) {
    const fill = n.fill ?? C.white;
    if (n.shape === 'ellipse')
      parts.push(roughEllipse(rnd, n.x + n.w / 2, n.y + n.h / 2, n.w / 2, n.h / 2, { fill }));
    else if (n.shape === 'diamond')
      parts.push(roughDiamond(rnd, n.x + n.w / 2, n.y + n.h / 2, n.w, n.h, { fill }));
    else if (n.shape === 'cylinder') parts.push(roughCylinder(rnd, n.x, n.y, n.w, n.h, { fill }));
    else parts.push(roughRect(rnd, n.x, n.y, n.w, n.h, { fill, dashed: n.dashed ?? false }));
    const lines = n.text.split('\n');
    parts.push(
      textBlock(n.x + n.w / 2, n.y + n.h / 2 + (n.shape === 'cylinder' ? 4 : 0), lines, {
        size: n.size ?? 17,
      }),
    );
  }
  for (const e of scene.edges ?? []) parts.push(arrow(rnd, byId[e.from], byId[e.to], e));
  for (const t of scene.texts ?? [])
    parts.push(
      textBlock(t.x, t.y, t.text.split('\n'), {
        size: t.size ?? 14,
        anchor: t.anchor ?? 'middle',
        color: t.color ?? '#495057',
      }),
    );
  const font = fontData
    ? `@font-face{font-family:'Patrick Hand';src:url(data:font/ttf;base64,${fontData}) format('truetype');}`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(scene.alt)}">
<title>${esc(scene.alt)}</title>
<style>${font}text{font-family:'Patrick Hand','Segoe Print','Bradley Hand','Comic Sans MS',cursive;}</style>
${parts.join('\n')}
</svg>
`;
}

// Excalidraw export: the same scene as editable elements (fontFamily 5 = Excalifont).
function toExcalidraw(scene) {
  const els = [];
  let seed = 1000;
  const base = (type, x, y, w, h, extra) => ({
    id: `${type}-${els.length + 1}`,
    type,
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    strokeColor: C.ink,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: type === 'rectangle' ? { type: 3 } : null,
    seed: seed++,
    version: 1,
    versionNonce: seed * 7,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...extra,
  });
  const text = (x, y, w, h, t, size, containerId) =>
    base('text', x, y, w, h, {
      text: t,
      originalText: t,
      fontSize: size,
      fontFamily: 5,
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId,
      lineHeight: 1.25,
      baseline: size,
      autoResize: true,
    });
  for (const g of scene.groups ?? []) {
    els.push(
      base('rectangle', g.x, g.y, g.w, g.h, {
        backgroundColor: g.fill ?? C.gray,
        strokeStyle: g.dashed ? 'dashed' : 'solid',
      }),
    );
    els.push(text(g.x + 10, g.y + 6, g.w - 20, 20, g.label, 14, null));
  }
  const ids = {};
  for (const n of scene.nodes) {
    const type =
      n.shape === 'ellipse' ? 'ellipse' : n.shape === 'diamond' ? 'diamond' : 'rectangle';
    const r = base(type, n.x, n.y, n.w, n.h, {
      backgroundColor: n.fill ?? C.white,
      strokeStyle: n.dashed ? 'dashed' : 'solid',
    });
    const t = text(n.x, n.y, n.w, n.h, n.text, n.size ?? 16, r.id);
    r.boundElements = [{ id: t.id, type: 'text' }];
    els.push(r, t);
    ids[n.id] = r;
  }
  for (const e of scene.edges ?? []) {
    const a = ids[e.from];
    const b = ids[e.to];
    const [x1, y1] = borderPoint(
      { ...a, shape: e.fromShape },
      b.x + b.width / 2,
      b.y + b.height / 2,
    );
    const [x2, y2] = borderPoint({ ...b, shape: e.toShape }, a.x + a.width / 2, a.y + a.height / 2);
    const arr = base('arrow', x1, y1, x2 - x1, y2 - y1, {
      points: [
        [0, 0],
        [x2 - x1, y2 - y1],
      ],
      lastCommittedPoint: null,
      startBinding: { elementId: a.id, focus: 0, gap: 4 },
      endBinding: { elementId: b.id, focus: 0, gap: 4 },
      startArrowhead: null,
      endArrowhead: 'arrow',
      strokeStyle: e.dashed ? 'dashed' : 'solid',
      roundness: { type: 2 },
    });
    if (e.label) {
      const t = text(
        x1 + (x2 - x1) / 2 - 60,
        y1 + (y2 - y1) / 2 - 10,
        120,
        20,
        e.label,
        13,
        arr.id,
      );
      arr.boundElements = [{ id: t.id, type: 'text' }];
      els.push(arr, t);
    } else els.push(arr);
  }
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://github.com/LucioY250/phdude',
    elements: els,
    appState: { viewBackgroundColor: '#ffffff', gridSize: null },
    files: {},
  };
}

const scenes = [
  {
    name: 'loop',
    alt: 'You talk to the agent; the agent runs the phdude CLI; the CLI validates and logs every write into the research workspace; skills and packs shape how the agent works.',
    width: 900,
    height: 330,
    seed: 11,
    nodes: [
      {
        id: 'you',
        shape: 'ellipse',
        x: 30,
        y: 120,
        w: 130,
        h: 80,
        text: 'You',
        fill: C.yellow,
        size: 20,
      },
      { id: 'agent', x: 230, y: 110, w: 190, h: 100, text: 'Claude Code\nor Codex', fill: C.blue },
      { id: 'cli', x: 490, y: 110, w: 150, h: 100, text: 'phdude CLI', fill: C.orange },
      {
        id: 'ws',
        shape: 'cylinder',
        x: 710,
        y: 95,
        w: 160,
        h: 130,
        text: 'research\nworkspace\nYAML + git',
        fill: C.green,
        size: 16,
      },
      {
        id: 'skills',
        x: 230,
        y: 250,
        w: 190,
        h: 56,
        text: 'skills · how to work',
        fill: C.purple,
        size: 15,
        dashed: true,
      },
      {
        id: 'packs',
        x: 490,
        y: 250,
        w: 190,
        h: 56,
        text: 'packs · field & method',
        fill: C.gray,
        size: 15,
        dashed: true,
      },
    ],
    edges: [
      { from: 'you', to: 'agent', label: 'ask' },
      { from: 'agent', to: 'cli', label: 'phdude … --json' },
      { from: 'cli', to: 'ws', label: 'validated,\nattributed, logged' },
      { from: 'skills', to: 'agent', dashed: true },
      { from: 'packs', to: 'agent', dashed: true },
    ],
    texts: [
      {
        x: 450,
        y: 50,
        text: 'The agent thinks. The harness remembers, validates, and refuses.',
        size: 16,
        color: '#495057',
      },
    ],
  },
  {
    name: 'layers',
    alt: 'Four layers: adapters talk to the outside, skills say how to work, packs adapt to a field or method, and the core remembers.',
    width: 900,
    height: 400,
    seed: 23,
    groups: [
      {
        x: 30,
        y: 40,
        w: 840,
        h: 76,
        fill: C.blue,
        label: 'ADAPTERS',
        note: 'how PhDude talks to the outside',
      },
      {
        x: 30,
        y: 130,
        w: 840,
        h: 76,
        fill: C.purple,
        label: 'SKILLS',
        note: 'what PhDude knows how to do',
      },
      {
        x: 30,
        y: 220,
        w: 840,
        h: 76,
        fill: C.orange,
        label: 'PACKS',
        note: 'how PhDude adapts to a field or method',
      },
      {
        x: 30,
        y: 310,
        w: 840,
        h: 76,
        fill: C.green,
        label: 'CORE',
        note: 'what PhDude knows and remembers',
      },
    ],
    nodes: [
      { id: 'a1', x: 150, y: 66, w: 150, h: 40, text: 'Claude Code host', size: 15 },
      { id: 'a2', x: 320, y: 66, w: 120, h: 40, text: 'Codex host', size: 15 },
      {
        id: 'a3',
        x: 460,
        y: 66,
        w: 250,
        h: 40,
        text: 'PDF · DOCX · PPTX · XLSX parsers',
        size: 15,
      },
      { id: 'a4', x: 730, y: 66, w: 90, h: 40, text: 'git', size: 15 },
      { id: 's1', x: 150, y: 156, w: 110, h: 40, text: 'bootstrap', size: 15 },
      { id: 's2', x: 280, y: 156, w: 120, h: 40, text: 'knowledge', size: 15 },
      { id: 's3', x: 420, y: 156, w: 110, h: 40, text: 'decisions', size: 15 },
      { id: 's4', x: 550, y: 156, w: 80, h: 40, text: 'next', size: 15 },
      { id: 's5', x: 650, y: 156, w: 170, h: 40, text: 'review modes', size: 15 },
      { id: 'p1', x: 150, y: 246, w: 170, h: 40, text: 'computer-science', size: 15 },
      { id: 'p2', x: 340, y: 246, w: 110, h: 40, text: 'medicine', size: 15 },
      { id: 'p3', x: 470, y: 246, w: 120, h: 40, text: 'humanities', size: 15 },
      { id: 'p4', x: 610, y: 246, w: 130, h: 40, text: 'quantitative', size: 15 },
      { id: 'p5', x: 760, y: 246, w: 60, h: 40, text: '…', size: 15 },
      { id: 'c1', x: 150, y: 336, w: 160, h: 40, text: 'workspace state', size: 15 },
      { id: 'c2', x: 330, y: 336, w: 200, h: 40, text: 'knowledge + provenance', size: 15 },
      { id: 'c3', x: 550, y: 336, w: 130, h: 40, text: 'approval gates', size: 15 },
      { id: 'c4', x: 700, y: 336, w: 120, h: 40, text: 'next rules', size: 15 },
    ],
  },
  {
    name: 'ingest',
    alt: 'Ingestion pipeline: discover files, inventory and hash them, deduplicate, extract text, cache it, link versions, record artifacts.',
    width: 900,
    height: 230,
    seed: 37,
    nodes: [
      {
        id: 'd',
        x: 20,
        y: 70,
        w: 110,
        h: 80,
        text: 'discover\nsources/**',
        fill: C.gray,
        size: 15,
      },
      {
        id: 'i',
        x: 150,
        y: 70,
        w: 115,
        h: 80,
        text: 'inventory\nsha256 to ART-id',
        fill: C.blue,
        size: 14,
      },
      {
        id: 'x',
        x: 285,
        y: 70,
        w: 110,
        h: 80,
        text: 'dedup\nsame hash,\nmany paths',
        fill: C.blue,
        size: 14,
      },
      {
        id: 'e',
        x: 415,
        y: 70,
        w: 120,
        h: 80,
        text: 'extract\ntext · sections\n· tables',
        fill: C.yellow,
        size: 14,
      },
      {
        id: 'c',
        shape: 'cylinder',
        x: 555,
        y: 60,
        w: 110,
        h: 100,
        text: 'cache\n.phdude/cache',
        fill: C.gray,
        size: 13,
      },
      {
        id: 'v',
        x: 685,
        y: 70,
        w: 100,
        h: 80,
        text: 'link\nversions\nv1, v2, v3',
        fill: C.purple,
        size: 14,
      },
      { id: 'r', x: 800, y: 70, w: 85, h: 80, text: 'record\nART-*.yaml', fill: C.green, size: 14 },
    ],
    edges: [
      { from: 'd', to: 'i' },
      { from: 'i', to: 'x' },
      { from: 'x', to: 'e' },
      { from: 'e', to: 'c' },
      { from: 'c', to: 'v' },
      { from: 'v', to: 'r' },
    ],
    texts: [
      {
        x: 450,
        y: 195,
        text: 'No model involved. Hashing, parsing and bookkeeping, idempotent: run it twice and nothing changes.',
        size: 14,
      },
    ],
  },
  {
    name: 'lineage',
    alt: 'Lineage: an artifact yields a source, the source yields evidence, the evidence supports a claim, the claim addresses a research question; the artifact also yields facts.',
    width: 900,
    height: 270,
    seed: 41,
    nodes: [
      {
        id: 'art',
        x: 20,
        y: 90,
        w: 140,
        h: 90,
        text: 'ART-…\nthesis.docx',
        fill: C.gray,
        size: 15,
      },
      {
        id: 'src',
        x: 215,
        y: 90,
        w: 140,
        h: 90,
        text: 'SRC-…\nSmith 2023',
        fill: C.blue,
        size: 15,
      },
      {
        id: 'evid',
        x: 410,
        y: 90,
        w: 150,
        h: 90,
        text: 'EVID-…\nn = 312, p. 41',
        fill: C.yellow,
        size: 15,
      },
      {
        id: 'claim',
        x: 615,
        y: 90,
        w: 140,
        h: 90,
        text: 'CLAIM-…\ncandidate',
        fill: C.orange,
        size: 15,
      },
      { id: 'rq', x: 790, y: 100, w: 95, h: 70, text: 'RQ-1', fill: C.purple, size: 16 },
      {
        id: 'fact',
        x: 215,
        y: 205,
        w: 200,
        h: 50,
        text: 'FACT-…  sample_size = 312',
        fill: C.green,
        size: 14,
      },
    ],
    edges: [
      { from: 'art', to: 'src', label: 'has artifact' },
      { from: 'src', to: 'evid', label: 'cites' },
      { from: 'evid', to: 'claim', label: 'supports' },
      { from: 'claim', to: 'rq', label: 'addresses' },
      { from: 'art', to: 'fact', label: 'from' },
    ],
    texts: [
      {
        x: 450,
        y: 40,
        text: 'phdude knowledge trace CLAIM-…  walks this graph both ways: "where did this number come from?"',
        size: 14,
      },
    ],
  },
  {
    name: 'states',
    alt: 'Knowledge states: candidate, supported, canonical, disputed, rejected. Only the move into canonical is gated, by an approved decision that names the object.',
    width: 900,
    height: 330,
    seed: 53,
    nodes: [
      { id: 'cand', x: 40, y: 110, w: 170, h: 80, text: 'candidate', fill: C.gray, size: 18 },
      { id: 'supp', x: 330, y: 110, w: 170, h: 80, text: 'supported', fill: C.yellow, size: 18 },
      { id: 'canon', x: 660, y: 110, w: 190, h: 80, text: 'canonical', fill: C.green, size: 18 },
      { id: 'disp', x: 330, y: 235, w: 170, h: 64, text: 'disputed', fill: C.orange, size: 17 },
      { id: 'rej', x: 40, y: 235, w: 170, h: 64, text: 'rejected', fill: C.red, size: 17 },
    ],
    edges: [
      { from: 'cand', to: 'supp', label: 'evidence linked' },
      { from: 'supp', to: 'canon', label: 'promote --decision DEC-x' },
      { from: 'canon', to: 'disp', label: 'contradicting\nevidence' },
      { from: 'disp', to: 'supp' },
      { from: 'supp', to: 'rej', via: [[250, 267]] },
      { from: 'rej', to: 'cand' },
    ],
    texts: [
      {
        x: 450,
        y: 40,
        text: 'every claim starts life as a candidate; only the move into canonical is gated',
        size: 15,
      },
      {
        x: 755,
        y: 230,
        text: 'the only gated move:\nDEC-x must be approved by a\nhuman and must name this object,\nor promote exits with code 3',
        size: 13,
        color: '#c92a2a',
      },
    ],
  },
  {
    name: 'next',
    alt: 'How the next action is chosen: a snapshot of the workspace goes through thirteen deterministic rules, candidates are ranked by impact, dependents and rule order, and the top action comes with its reasons and the exact command.',
    width: 900,
    height: 340,
    seed: 67,
    nodes: [
      {
        id: 'snap',
        shape: 'cylinder',
        x: 30,
        y: 110,
        w: 130,
        h: 110,
        text: 'workspace\nsnapshot',
        fill: C.gray,
        size: 15,
      },
      {
        id: 'rules',
        shape: 'diamond',
        x: 200,
        y: 105,
        w: 150,
        h: 120,
        text: 'thirteen\nrules',
        fill: C.purple,
        size: 17,
      },
      { id: 'q1', x: 400, y: 30, w: 210, h: 40, text: 'no research questions?', size: 14 },
      { id: 'q2', x: 400, y: 80, w: 210, h: 40, text: 'artifacts without text?', size: 14 },
      {
        id: 'q3',
        x: 400,
        y: 130,
        w: 210,
        h: 40,
        text: 'open fact conflicts?',
        size: 14,
        fill: C.red,
      },
      { id: 'q4', x: 400, y: 180, w: 210, h: 40, text: 'claims without evidence?', size: 14 },
      { id: 'q5', x: 400, y: 230, w: 210, h: 40, text: 'decisions awaiting approval?', size: 14 },
      { id: 'q6', x: 400, y: 280, w: 210, h: 40, text: '…', size: 14 },
      {
        id: 'rank',
        x: 660,
        y: 105,
        w: 110,
        h: 120,
        text: 'rank\nimpact ›\ndependents ›\nrule order',
        fill: C.yellow,
        size: 14,
      },
      {
        id: 'top',
        x: 800,
        y: 95,
        w: 85,
        h: 140,
        text: 'top\naction\n+ why\n+ command',
        fill: C.green,
        size: 14,
      },
    ],
    edges: [
      { from: 'snap', to: 'rules' },
      ...['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((q) => ({
        from: 'rules',
        to: q,
        fromSide: 'right',
        toSide: 'left',
      })),
      ...['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((q) => ({
        from: q,
        to: 'rank',
        fromSide: 'right',
        toSide: 'left',
      })),
      { from: 'rank', to: 'top' },
    ],
  },
  {
    name: 'writing',
    alt: 'The writing loop: phdude write assembles the context, the agent drafts, submit runs five gates, a block returns findings and writes nothing, a pass records the section, deslop revises it, and a decision approves it.',
    width: 900,
    height: 310,
    seed: 61,
    nodes: [
      {
        id: 'w',
        x: 20,
        y: 60,
        w: 120,
        h: 85,
        text: 'phdude write\nclaims · evidence\n· keys · voice',
        fill: C.gray,
        size: 13,
      },
      {
        id: 'a',
        x: 165,
        y: 60,
        w: 110,
        h: 85,
        text: 'the agent\ndrafts\nMarkdown',
        fill: C.blue,
        size: 14,
      },
      {
        id: 'g',
        x: 300,
        y: 45,
        w: 175,
        h: 115,
        text: 'submit\ncitations · evidence\n· prose · voice\n· meaning · venue',
        fill: C.yellow,
        size: 13,
      },
      {
        id: 'blocked',
        x: 300,
        y: 205,
        w: 175,
        h: 65,
        text: 'blocked: findings\nwith line numbers,\nnothing written',
        fill: C.red,
        size: 13,
      },
      {
        id: 's',
        x: 505,
        y: 60,
        w: 120,
        h: 85,
        text: 'section\nrecorded\ndraft / revised',
        fill: C.green,
        size: 14,
      },
      {
        id: 'ds',
        x: 505,
        y: 205,
        w: 120,
        h: 65,
        text: 'phdude deslop\nthe revision',
        fill: C.purple,
        size: 13,
      },
      {
        id: 'dec',
        x: 665,
        y: 60,
        w: 110,
        h: 85,
        text: 'a decision\nyou approved',
        fill: C.orange,
        size: 14,
      },
      {
        id: 'ap',
        x: 800,
        y: 60,
        w: 85,
        h: 85,
        text: 'approved',
        fill: C.green,
        size: 15,
      },
    ],
    edges: [
      { from: 'w', to: 'a' },
      { from: 'a', to: 'g' },
      { from: 'g', to: 'blocked', fromSide: 'bottom', toSide: 'top' },
      { from: 'blocked', to: 'a', fromSide: 'left', toSide: 'bottom' },
      { from: 'g', to: 's' },
      { from: 's', to: 'ds', fromSide: 'bottom', toSide: 'top' },
      { from: 'ds', to: 'g', fromSide: 'left', toSide: 'bottom' },
      { from: 's', to: 'dec' },
      { from: 'dec', to: 'ap' },
    ],
    texts: [
      {
        x: 450,
        y: 292,
        text: 'Only the CLI writes under manuscript/. Approval is a human act: a decision you approved, naming the section.',
        size: 14,
      },
    ],
  },
];

mkdirSync(OUT, { recursive: true });
let fontData = null;
try {
  fontData = readFileSync(FONT_PATH).toString('base64');
} catch {
  console.warn(`font not found at ${FONT_PATH}; SVGs will use the fallback font stack`);
}
for (const scene of scenes) {
  writeFileSync(join(OUT, `${scene.name}.svg`), renderSvg(scene, fontData));
  writeFileSync(
    join(OUT, `${scene.name}.excalidraw`),
    JSON.stringify(toExcalidraw(scene), null, 2) + '\n',
  );
  console.log(`wrote ${scene.name}.svg + ${scene.name}.excalidraw`);
}

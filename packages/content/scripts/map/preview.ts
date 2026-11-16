// Draws preview.svg and preview.png from the data files only (the reference image is not used).
// Usage: pnpm --filter @shinobi/content exec tsx scripts/map/preview.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { COLS, ROWS, at, hexCenter, hexCorners, neighbours } from './grid.ts';

const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/Shinobi Idle — MVP — зріз і баланс/map',
);
const read = <T>(f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T;

// Palette tokens of "Shinobi Idle — інтерфейс і візуальний стиль.md", section 2.
const TOKENS: Record<string, string> = {
  'ink-900': '#14161B',
  'ink-800': '#1E2129',
  'ink-600': '#353A46',
  paper: '#EFE3C8',
  'paper-ink': '#2A2118',
  text: '#E8E6E1',
  'text-dim': '#9CA3AF',
  orange: '#F27A1A',
  leaf: '#5E8C3A',
  steel: '#8A99A8',
  hanko: '#C8372D',
  chakra: '#3DA5F4',
  stamina: '#E3B341',
  katon: '#E5532D',
  futon: '#7BC8A4',
  raiton: '#F2C94C',
  doton: '#A9805B',
  suiton: '#3B8FD9',
};

const token = (name: string): string => {
  const v = TOKENS[name];
  if (v === undefined) throw new Error(`unknown colour token ${name}`);
  return v;
};
const rgb = (h: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const used = new Map<string, string>(); // derived colour -> recipe
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(token(a));
  const [br, bg, bb] = rgb(token(b));
  const c =
    '#' +
    [ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]
      .map((v) => Math.round(v).toString(16).padStart(2, '0'))
      .join('');
  used.set(c.toUpperCase(), `${a} + ${b} ${Math.round(t * 100)}%`);
  return c;
}
const tok = (name: string): string => {
  used.set(token(name).toUpperCase(), `токен ${name}`);
  return token(name);
};

interface HexRec {
  q: number;
  r: number;
  country: string;
  playable?: boolean;
  terrain?: string;
}
interface CountryRec {
  id: string;
  name: string;
  token: string;
  hexes: number;
}
interface PlaceRec {
  id: string;
  name: string;
  kind: string;
  hex: [number, number];
  country: string;
}

interface FirePlaceRec {
  id: string;
  hex: [number, number];
  role: string;
  invented: boolean;
  previewLabel: string;
  labelled: boolean;
  placeRef: string | null;
  absorbsCell: string | null;
}
interface CellRec {
  cell: string;
  hex: [number, number];
}

const world = read<{ hexes: HexRec[] }>('world-hex.json');
const firePlaces = read<FirePlaceRec[]>('fire-places.json');
const sliceCells = read<CellRec[]>('slice-cells.json');
// Places drawn by the generic role markers: everything not already drawn from places.json.
const roleMarked = firePlaces.filter((p) => p.placeRef === null);
const withRecord = new Set(firePlaces.filter((p) => p.absorbsCell).map((p) => p.absorbsCell));
const cellOnly = sliceCells.filter((c) => !withRecord.has(c.cell));
const countries = read<CountryRec[]>('countries.json');
const places = read<PlaceRec[]>('places.json');

const colRow = (h: { q: number; r: number }): [number, number] => [
  h.q + (h.r - (h.r & 1)) / 2,
  h.r,
];
const byRC = new Map<string, HexRec>();
for (const h of world.hexes) {
  const [c, r] = colRow(h);
  byRC.set(`${c},${r}`, h);
}
const hexRec = (c: number, r: number): HexRec => {
  const h = byRC.get(`${c},${r}`);
  if (!h) throw new Error(`no hex ${c},${r}`);
  return h;
};

const W = 1920;
const H = 1080;
const FONT = "Onest, Arial, 'Segoe UI', sans-serif";
const seaColour = mix('ink-800', 'chakra', 0.1);
const gridLine = mix('ink-800', 'steel', 0.22);
const coastInk = tok('ink-900');
const borderInk = tok('paper-ink');
const countryToken = new Map(countries.map((c) => [c.id, c.token]));
const landFill = (id: string) => mix('paper', countryToken.get(id) ?? 'ink-600', 0.28);
const TERRAIN_FILL: Record<string, () => string> = {
  forest: () => mix('paper', 'leaf', 0.5),
  plains: () => mix('paper', 'stamina', 0.22),
  hills: () => mix('paper', 'doton', 0.45),
  coast: () => mix('paper', 'chakra', 0.2),
  river: () => mix('paper', 'chakra', 0.45),
  lake: () => mix('paper', 'chakra', 0.7),
  road: () => mix('paper', 'doton', 0.15),
  settlement: () => tok('paper'),
};

const pts = (p: [number, number][]) =>
  p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const EDGE_OF_DIR = [1, 0, 5, 4, 3, 2]; // neighbours() order E,NE,NW,W,SW,SE -> corner index of the shared edge

let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">\n`;
svg += `<title>Світ шинобі: мапа з шестикутників</title>\n<rect width="${W}" height="${H}" fill="${seaColour}"/>\n`;

// Sea grid lines (faint) and land fills.
let g = '';
let land = '';
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    const h = hexRec(c, r);
    const poly = pts(hexCorners(c, r));
    if (h.country === 'sea')
      g += `<polygon points="${poly}" fill="none" stroke="${gridLine}" stroke-width="0.7"/>`;
    else {
      const fill =
        h.playable && h.terrain
          ? (TERRAIN_FILL[h.terrain]?.() ?? landFill(h.country))
          : landFill(h.country);
      land += `<polygon points="${poly}" fill="${fill}" stroke="${mix('paper-ink', 'paper', 0.7)}" stroke-width="${h.playable ? 0.9 : 0.5}"/>`;
    }
  }
svg += `<g>${g}</g>\n<g>${land}</g>\n`;

// Rivers and roads of the playable area, drawn between neighbouring hexes.
const riverish = (t?: string) => t === 'river' || t === 'lake';
const roadish = (t?: string) => t === 'road' || t === 'settlement';
let lines = '';
for (const h of world.hexes) {
  if (!h.playable) continue;
  const [c, r] = colRow(h);
  const [x, y] = hexCenter(c, r);
  for (const n of neighbours(c, r)) {
    if (!n) continue;
    const m = hexRec(n[0], n[1]);
    if (!m.playable) continue;
    const [x2, y2] = hexCenter(n[0], n[1]);
    if (
      riverish(h.terrain) &&
      (riverish(m.terrain) || m.terrain === 'settlement' || m.terrain === 'coast')
    )
      lines += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${tok('chakra')}" stroke-width="3.5" stroke-linecap="round"/>`;
    if (roadish(h.terrain) && roadish(m.terrain))
      lines += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${tok('paper-ink')}" stroke-width="2.2" stroke-dasharray="1 5" stroke-linecap="round"/>`;
  }
}
svg += `<g>${lines}</g>\n`;

// Borders and coastlines along hex edges.
let borders = '';
let coasts = '';
let outline = '';
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    const h = hexRec(c, r);
    const corners = hexCorners(c, r);
    const ns = neighbours(c, r);
    for (let d = 0; d < 6; d++) {
      const n = ns[d];
      const m = n ? hexRec(n[0], n[1]) : undefined;
      const i = at(EDGE_OF_DIR, d);
      const a = at(corners, i);
      const b = at(corners, (i + 1) % 6);
      const seg = `x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"`;
      const mc = m ? m.country : 'sea';
      if (h.country !== 'sea' && mc === 'sea') coasts += `<line ${seg}/>`;
      else if (h.country !== 'sea' && mc !== 'sea' && h.country > mc) borders += `<line ${seg}/>`;
      if (h.playable && !(m && m.playable)) outline += `<line ${seg}/>`;
    }
  }
svg += `<g stroke="${borderInk}" stroke-width="1.6" stroke-dasharray="6 3" stroke-linecap="round">${borders}</g>\n`;
svg += `<g stroke="${coastInk}" stroke-width="3" stroke-linecap="round">${coasts}</g>\n`;
svg += `<g stroke="${tok('orange')}" stroke-width="3.5" stroke-linecap="round">${outline}</g>\n`;

// ---------------------------------------------------------------------------------------------
// Label layout. Every label is a box; boxes are placed greedily on the first free candidate position
// and the final set is checked: two intersecting boxes make the script fail.
// ---------------------------------------------------------------------------------------------
interface Box {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const boxes: Box[] = [];
const intersects = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const fits = (b: Box) =>
  b.x0 >= 4 && b.y0 >= 4 && b.x1 <= W - 4 && b.y1 <= H - 4 && boxes.every((o) => !intersects(o, b));
/** Throws when two label boxes (or a label and a marker, the compass, the legend) intersect. */
function assertNoOverlap(all: Box[]): void {
  const bad: string[] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = at(all, i);
      const b = at(all, j);
      if (intersects(a, b)) bad.push(`${a.id} x ${b.id}`);
    }
  if (bad.length) throw new Error(`label boxes intersect: ${bad.join('; ')}`);
}
/** Conservative text width estimate for a bold/semibold sans-serif face. */
function textWidth(text: string, size: number, spacing: number): number {
  let w = 0;
  for (const ch of text)
    w +=
      (ch === ' ' ? 0.32 : ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? 0.74 : 0.6) * size +
      spacing;
  return w;
}

// Fixed things first: place markers, compass, legend.
const markerFill = tok('hanko');
const markerInk = tok('paper-ink');
const markerPaper = tok('paper');
const placeXY = (p: PlaceRec): [number, number] => {
  const [q, r] = p.hex;
  return hexCenter(q + (r - (r & 1)) / 2, r);
};
for (const p of places) {
  if (p.kind === 'country') continue;
  const [x, y] = placeXY(p);
  boxes.push({ id: `marker ${p.id}`, x0: x - 10, y0: y - 10, x1: x + 10, y1: y + 10 });
}
const axialXY = (hex: [number, number]): [number, number] =>
  hexCenter(hex[0] + (hex[1] - (hex[1] & 1)) / 2, hex[1]);
for (const p of roleMarked) {
  const [x, y] = axialXY(p.hex);
  boxes.push({ id: `marker ${p.id}`, x0: x - 10, y0: y - 10, x1: x + 10, y1: y + 10 });
}
for (const c of cellOnly) {
  const [x, y] = axialXY(c.hex);
  boxes.push({ id: `cell ${c.cell}`, x0: x - 6, y0: y - 6, x1: x + 6, y1: y + 6 });
}
const COMPASS = { cx: 1830, cy: 930, R: 46 };
boxes.push({
  id: 'compass',
  x0: COMPASS.cx - COMPASS.R - 10,
  y0: COMPASS.cy - COMPASS.R - 36,
  x1: COMPASS.cx + COMPASS.R + 10,
  y1: COMPASS.cy + COMPASS.R + 10,
});
const LEGEND = { x0: 1168, y0: 1012, x1: 1830, y1: 1052 };
boxes.push({ id: 'legend', ...LEGEND });
const LEGEND2 = { x0: 960, y0: 8, x1: 1226, y1: 120 };
boxes.push({ id: 'legend roles', ...LEGEND2 });

// Country labels at the centroid of the largest connected group of hexes; move off collisions.
function largestGroup(id: string): [number, number][] {
  const key = (c: number, r: number) => `${c},${r}`;
  const left = new Set(world.hexes.filter((h) => h.country === id).map((h) => key(...colRow(h))));
  let best: [number, number][] = [];
  for (;;) {
    const first = left.values().next().value;
    if (first === undefined) break;
    const stack = [first];
    const grp: [number, number][] = [];
    left.delete(first);
    while (stack.length) {
      const k = stack.pop() as string;
      const [c = 0, r = 0] = k.split(',').map(Number);
      grp.push([c, r]);
      for (const n of neighbours(c, r))
        if (n && left.has(key(n[0], n[1]))) {
          left.delete(key(n[0], n[1]));
          stack.push(key(n[0], n[1]));
        }
    }
    if (grp.length > best.length) best = grp;
  }
  return best;
}
/** Offsets tried in order: the centroid, then rings of growing radius. */
const OFFSETS: [number, number][] = [[0, 0]];
for (const ring of [22, 44, 68, 96, 128, 170, 220])
  for (let i = 0; i < 16; i++)
    OFFSETS.push([
      Math.round(ring * Math.cos((Math.PI / 8) * i) * 1.3),
      Math.round(ring * Math.sin((Math.PI / 8) * i)),
    ]);

let labels = '';
let leaders = '';
const countryLabels = countries
  .map((c) => ({ c, grp: largestGroup(c.id) }))
  .filter((x) => x.grp.length > 0)
  .sort((a, b) => b.grp.length - a.grp.length);
for (const { c, grp } of countryLabels) {
  let sx = 0;
  let sy = 0;
  for (const [col, row] of grp) {
    const [x, y] = hexCenter(col, row);
    sx += x;
    sy += y;
  }
  const cx = sx / grp.length;
  const cy = sy / grp.length;
  const big = grp.length >= 40;
  const size = big ? 30 : grp.length >= 10 ? 16 : 13;
  const spacing = big ? 3 : 1;
  const words = c.name.toUpperCase().split(' ');
  const textLines =
    big || words.length < 2 ? [words.join(' ')] : [words[0] ?? '', words.slice(1).join(' ')];
  const width = Math.max(...textLines.map((t) => textWidth(t, size, spacing)));
  const height = textLines.length * (size + 2);
  let placed = false;
  for (const [dx, dy] of OFFSETS) {
    const x = cx + dx;
    const y = cy + dy;
    const box: Box = {
      id: `country ${c.id}`,
      x0: x - width / 2 - 3,
      y0: y - height / 2 - 2,
      x1: x + width / 2 + 3,
      y1: y + height / 2 + 2,
    };
    if (!fits(box)) continue;
    boxes.push(box);
    textLines.forEach((t, i) => {
      const ty = y - height / 2 + (i + 1) * (size + 2) - 4;
      labels += `<text x="${x.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" font-size="${size}" font-weight="700" letter-spacing="${spacing}" fill="${borderInk}" fill-opacity="0.85" stroke="${tok('paper')}" stroke-opacity="0.55" stroke-width="3" paint-order="stroke">${t}</text>`;
    });
    if (Math.hypot(dx, dy) > 60)
      leaders += `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    placed = true;
    break;
  }
  if (!placed) throw new Error(`no free position for the label of ${c.id}`);
}

// Place labels: the full Ukrainian name from places.json, right of the marker, else left, above, below.
let marks = '';
let names = '';
const PLACE_SIZE = 12.5;
for (const p of places) {
  if (p.kind === 'country') continue;
  const [x, y] = placeXY(p);
  const s = `stroke="${markerPaper}" stroke-width="1.6"`;
  if (p.kind === 'hidden-village')
    marks += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" fill="${markerFill}" ${s}/>`;
  else if (p.kind === 'town')
    marks += `<rect x="${(x - 7).toFixed(1)}" y="${(y - 7).toFixed(1)}" width="14" height="14" fill="${markerInk}" ${s}/>`;
  else if (p.kind === 'village')
    marks += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${markerPaper}" stroke="${markerInk}" stroke-width="2"/>`;
  else if (p.kind === 'hideout')
    marks += `<polygon points="${pts([
      [x, y - 8],
      [x + 8, y + 6],
      [x - 8, y + 6],
    ])}" fill="${markerInk}" ${s}/>`;
  else
    marks += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${markerInk}" ${s}/>`;
}
/** Generic marker of a role (no franchise symbols): invented places are hollow, canonical ones solid. */
function roleMarker(role: string, x: number, y: number, invented: boolean): string {
  const fill = invented ? markerPaper : markerInk;
  const line = invented ? markerInk : markerPaper;
  const sw = invented ? 2 : 1.6;
  const st = `fill="${fill}" stroke="${line}" stroke-width="${sw}"`;
  const X = x.toFixed(1);
  const Y = y.toFixed(1);
  switch (role) {
    case 'settlement':
      return `<rect x="${(x - 6).toFixed(1)}" y="${(y - 6).toFixed(1)}" width="12" height="12" ${st}/>`;
    case 'outpost':
      return `<polygon points="${pts([
        [x, y - 8],
        [x + 8, y],
        [x, y + 8],
        [x - 8, y],
      ])}" ${st}/>`;
    case 'training':
      return `<circle cx="${X}" cy="${Y}" r="7" ${st}/><circle cx="${X}" cy="${Y}" r="2.2" fill="${line}"/>`;
    case 'deposit':
      return `<polygon points="${pts([
        [x - 7, y - 6],
        [x + 7, y - 6],
        [x, y + 7],
      ])}" ${st}/>`;
    case 'cache':
    case 'vault':
      return `<polygon points="${pts([
        [x, y - 7],
        [x + 7, y + 6],
        [x - 7, y + 6],
      ])}" ${st}/>`;
    case 'zone':
      return `<circle cx="${X}" cy="${Y}" r="7" ${st}/><path d="M${(x - 3.5).toFixed(1)} ${(y - 3.5).toFixed(1)}L${(x + 3.5).toFixed(1)} ${(y + 3.5).toFixed(1)}M${(x + 3.5).toFixed(1)} ${(y - 3.5).toFixed(1)}L${(x - 3.5).toFixed(1)} ${(y + 3.5).toFixed(1)}" stroke="${line}" stroke-width="1.8"/>`;
    default:
      return `<circle cx="${X}" cy="${Y}" r="4.5" ${st}/>`;
  }
}
// Slice cells without a place record: a small dot, so the density of the exploration is visible.
let cellDots = '';
for (const c of cellOnly) {
  const [x, y] = axialXY(c.hex);
  cellDots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${markerInk}" fill-opacity="0.8" stroke="${markerPaper}" stroke-width="0.8"/>`;
}
for (const p of roleMarked) {
  const [x, y] = axialXY(p.hex);
  marks += roleMarker(p.role, x, y, p.invented);
}
const placeLabelBoxes: { item: LabelItem; x: number; y: number; anchor: string; box: Box }[] = [];
interface LabelItem {
  id: string;
  text: string;
  x: number;
  y: number;
  optional: boolean;
  onSea: boolean;
}
const labelItems: LabelItem[] = [
  ...places
    .filter((p) => p.kind !== 'country')
    .map((p) => {
      const [x, y] = placeXY(p);
      return { id: p.id, text: p.name, x, y, optional: false, onSea: p.country === 'sea' };
    }),
  ...roleMarked
    .filter((p) => p.labelled)
    .map((p) => {
      const [x, y] = axialXY(p.hex);
      return { id: p.id, text: p.previewLabel, x, y, optional: true, onSea: false };
    }),
];
const omittedLabels: string[] = [];
for (const item of labelItems) {
  const { x, y } = item;
  const w = textWidth(item.text, PLACE_SIZE, 0) + 4;
  const cands: { ax: number; ay: number; anchor: string; b: [number, number, number, number] }[] =
    [];
  for (const lift of [0, -14, 14, -28, 28, -44, 44]) {
    cands.push({
      ax: x + 11,
      ay: y + 4 + lift,
      anchor: 'start',
      b: [x + 11, y - 8 + lift, x + 11 + w, y + 8 + lift],
    });
    cands.push({
      ax: x - 11,
      ay: y + 4 + lift,
      anchor: 'end',
      b: [x - 11 - w, y - 8 + lift, x - 11, y + 8 + lift],
    });
  }
  cands.push({ ax: x, ay: y - 14, anchor: 'middle', b: [x - w / 2, y - 27, x + w / 2, y - 11] });
  cands.push({ ax: x, ay: y + 24, anchor: 'middle', b: [x - w / 2, y + 11, x + w / 2, y + 27] });
  let chosen = false;
  for (const cand of cands) {
    const box: Box = {
      id: `place ${item.id}`,
      x0: cand.b[0],
      y0: cand.b[1],
      x1: cand.b[2],
      y1: cand.b[3],
    };
    // the own marker box is only ±10 around the centre, so labels starting at ±11 never touch it
    if (!fits(box)) continue;
    boxes.push(box);
    placeLabelBoxes.push({ item, x: cand.ax, y: cand.ay, anchor: cand.anchor, box });
    chosen = true;
    break;
  }
  if (!chosen) {
    if (!item.optional) throw new Error(`no free position for the label of ${item.id}`);
    omittedLabels.push(item.id);
  }
}
for (const { item, x, y, anchor } of placeLabelBoxes) {
  const onSea = item.onSea;
  names += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="${PLACE_SIZE}" font-weight="600" fill="${onSea ? tok('paper') : markerInk}" stroke="${onSea ? coastInk : markerPaper}" stroke-opacity="0.85" stroke-width="3" paint-order="stroke">${item.text}</text>`;
}
assertNoOverlap(boxes);

svg += `<g stroke="${borderInk}" stroke-width="1" stroke-opacity="0.6" stroke-dasharray="3 3">${leaders}</g>\n`;
svg += `<g>${labels}</g>\n<g>${cellDots}</g>\n<g>${marks}</g>\n<g>${names}</g>\n`;

// Our own compass, bottom right (sea).
{
  const { cx, cy, R } = COMPASS;
  const star: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? R : R * 0.34;
    star.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  svg += `<g><circle cx="${cx}" cy="${cy}" r="${R + 8}" fill="none" stroke="${tok('steel')}" stroke-width="2"/><polygon points="${pts(star)}" fill="${markerPaper}" stroke="${coastInk}" stroke-width="1.5"/><polygon points="${pts(
    [
      [cx, cy - R],
      [cx + R * 0.17, cy - R * 0.34 * 0.7],
      [cx - R * 0.17, cy - R * 0.34 * 0.7],
    ],
  )}" fill="${markerFill}"/><text x="${cx}" y="${cy - R - 14}" text-anchor="middle" font-size="15" font-weight="700" fill="${tok('text')}">Пн</text></g>\n`;
}

// Legend, bottom (sea).
{
  const x0 = 1180;
  const y0 = 1034;
  let l = `<rect x="${LEGEND.x0}" y="${LEGEND.y0}" width="${LEGEND.x1 - LEGEND.x0}" height="${LEGEND.y1 - LEGEND.y0}" rx="4" fill="${tok('ink-800')}" fill-opacity="0.88" stroke="${tok('ink-600')}"/>`;
  const item = (dx: number, mark: string, text: string) =>
    `${mark.replace(/__X__/g, String(x0 + dx))}<text x="${x0 + dx + 14}" y="${y0 + 4}" font-size="12.5" fill="${tok('text')}">${text}</text>`;
  l += item(
    0,
    `<circle cx="__X__" cy="${y0}" r="7" fill="${markerFill}" stroke="${markerPaper}" stroke-width="1.5"/>`,
    'приховане селище',
  );
  l += item(
    140,
    `<rect x="__X__" y="${y0 - 6}" width="12" height="12" fill="${markerInk}" stroke="${markerPaper}" stroke-width="1.5" transform="translate(-6 0)"/>`,
    'місто',
  );
  l += item(
    205,
    `<circle cx="__X__" cy="${y0}" r="4.5" fill="${markerInk}" stroke="${markerPaper}" stroke-width="1.5"/>`,
    'місце',
  );
  l += item(
    265,
    `<polygon points="__X__,${y0 - 7} ${x0 + 265 + 7},${y0 + 5} ${x0 + 265 - 7},${y0 + 5}" fill="${markerInk}" stroke="${markerPaper}" stroke-width="1.5"/>`,
    'сховок',
  );
  l += item(
    335,
    `<line x1="${x0 + 335 - 12}" y1="${y0}" x2="${x0 + 335 + 8}" y2="${y0}" stroke="${tok('orange')}" stroke-width="4"/>`,
    'ігрова зона MVP',
  );
  l += item(
    480,
    `<line x1="${x0 + 480 - 12}" y1="${y0}" x2="${x0 + 480 + 8}" y2="${y0}" stroke="${tok('chakra')}" stroke-width="4"/>`,
    'річка',
  );
  svg += `<g>${l}</g>\n`;
}
{
  const items: [string, string][] = [
    ['settlement', 'селище'],
    ['outpost', 'застава'],
    ['training', 'тренування'],
    ['deposit', 'родовище'],
    ['cache', 'сховок'],
    ['zone', 'ворожа зона'],
    ['landmark', 'пам’ятне місце'],
  ];
  let l = `<rect x="${LEGEND2.x0}" y="${LEGEND2.y0}" width="${LEGEND2.x1 - LEGEND2.x0}" height="${LEGEND2.y1 - LEGEND2.y0}" rx="4" fill="${tok('ink-800')}" fill-opacity="0.88" stroke="${tok('ink-600')}"/>`;
  const txt = (x: number, y: number, t: string) =>
    `<text x="${x}" y="${y + 4}" font-size="12" fill="${tok('text')}">${t}</text>`;
  items.forEach(([role, label], i) => {
    const x = LEGEND2.x0 + 18 + (i < 5 ? 0 : 128);
    const y = LEGEND2.y0 + 16 + (i % 5) * 20;
    l += roleMarker(role, x, y, false) + txt(x + 13, y, label);
  });
  {
    const x1 = LEGEND2.x0 + 18 + 128;
    l +=
      roleMarker('landmark', x1, LEGEND2.y0 + 56, true) +
      txt(x1 + 13, LEGEND2.y0 + 56, 'вигадане: світлий');
    const x2 = x1;
    const y = LEGEND2.y0 + 76;
    l +=
      '<circle cx="' +
      x2 +
      '" cy="' +
      y +
      '" r="3.5" fill="' +
      markerInk +
      '" fill-opacity="0.8" stroke="' +
      markerPaper +
      '" stroke-width="0.8"/>' +
      txt(x2 + 13, y, 'клітинка зрізу');
  }
  svg += `<g>${l}</g>\n`;
}
svg += `</svg>\n`;

writeFileSync(join(dir, 'preview.svg'), svg);
await sharp(Buffer.from(svg), { density: 96 })
  .resize({ width: 1600 })
  .png({ compressionLevel: 9 })
  .toFile(join(dir, 'preview.png'));
console.log('label boxes:', boxes.length, '- no intersections');
console.log('labels omitted (marker only):', omittedLabels.join(', ') || 'none');
console.log('colours used:');
for (const [c, why] of [...used].sort()) console.log(c, why);

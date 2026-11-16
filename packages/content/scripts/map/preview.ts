// Draws preview.svg and preview.png from the data files only (the reference image is not used).
// Usage: pnpm --filter @shinobi/content exec tsx scripts/map/preview.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { COLS, HEX_S, ROWS, hexAt, hexCenter, hexCorners, neighbours } from './grid.ts';

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

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const used = new Map<string, string>(); // derived colour -> recipe
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(TOKENS[a]);
  const [br, bg, bb] = rgb(TOKENS[b]);
  const c =
    '#' +
    [ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]
      .map((v) => Math.round(v).toString(16).padStart(2, '0'))
      .join('');
  used.set(c.toUpperCase(), `${a} + ${b} ${Math.round(t * 100)}%`);
  return c;
}
const tok = (name: string) => {
  used.set(TOKENS[name].toUpperCase(), `токен ${name}`);
  return TOKENS[name];
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

const world = read<{ hexes: HexRec[] }>('world-hex.json');
const countries = read<CountryRec[]>('countries.json');
const places = read<PlaceRec[]>('places.json');

const byRC = new Map<string, HexRec>(); // key "col,row"
const colRow = (h: HexRec): [number, number] => [h.q + (h.r - (h.r & 1)) / 2, h.r];
for (const h of world.hexes) {
  const [c, r] = colRow(h);
  byRC.set(`${c},${r}`, h);
}
const at = (c: number, r: number) => byRC.get(`${c},${r}`);

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
    const h = at(c, r)!;
    const poly = pts(hexCorners(c, r));
    if (h.country === 'sea')
      g += `<polygon points="${poly}" fill="none" stroke="${gridLine}" stroke-width="0.7"/>`;
    else {
      const fill = h.playable && h.terrain ? TERRAIN_FILL[h.terrain]() : landFill(h.country);
      land += `<polygon points="${poly}" fill="${fill}" stroke="${mix('paper-ink', 'paper', 0.7)}" stroke-width="${h.playable ? 0.9 : 0.5}"/>`;
    }
  }
svg += `<g>${g}</g>\n<g>${land}</g>\n`;

// Rivers and roads of the playable area, drawn between neighbouring hexes.
let lines = '';
for (const h of world.hexes) {
  if (!h.playable) continue;
  const [c, r] = colRow(h);
  const [x, y] = hexCenter(c, r);
  for (const n of neighbours(c, r)) {
    if (!n) continue;
    const m = at(n[0], n[1])!;
    if (!m.playable) continue;
    const [x2, y2] = hexCenter(n[0], n[1]);
    const riverish = (t?: string) => t === 'river' || t === 'lake';
    const roadish = (t?: string) => t === 'road' || t === 'settlement';
    if (
      riverish(h.terrain) &&
      (riverish(m.terrain) || m.terrain === 'settlement' || m.terrain === 'coast') &&
      !(m.terrain === 'coast' && !m.terrain)
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
    const h = at(c, r)!;
    const corners = hexCorners(c, r);
    const ns = neighbours(c, r);
    for (let d = 0; d < 6; d++) {
      const n = ns[d];
      const m = n ? at(n[0], n[1])! : undefined;
      const i = EDGE_OF_DIR[d];
      const a = corners[i];
      const b = corners[(i + 1) % 6];
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

// Country labels at the centroid of the country's largest connected group of hexes.
function largestGroup(id: string): [number, number][] {
  const cells = world.hexes.filter((h) => h.country === id).map(colRow);
  const key = (c: number, r: number) => `${c},${r}`;
  const left = new Set(cells.map(([c, r]) => key(c, r)));
  let best: [number, number][] = [];
  while (left.size) {
    const first = [...left][0];
    const stack = [first];
    const grp: [number, number][] = [];
    left.delete(first);
    while (stack.length) {
      const k = stack.pop()!;
      const [c, r] = k.split(',').map(Number);
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
const LABEL_NUDGE: Record<string, [number, number]> = {
  'core:water': [0, -60],
  'core:lightning': [0, 5],
  'core:fire': [20, 105],
  'core:steam': [-30, -45],
  'core:frost': [20, -50],
  'core:waterfall': [-10, -35],
  'core:disputed': [10, -25],
  'core:rain': [-25, 48],
  'core:rivers': [0, 70],
  'core:rock': [0, 12],
};
const SIDE: Record<string, 'l' | 'r'> = {
  'core:pottery-village': 'l',
  'core:hidden-valley-village': 'r',
  'core:hidden-rain': 'l',
  'core:tanzaku': 'l',
  'core:hidden-rock-village': 'l',
  'core:hidden-hot-spring': 'r',
};
let labels = '';
for (const c of countries) {
  const grp = largestGroup(c.id);
  if (!grp.length) continue;
  let sx = 0,
    sy = 0;
  for (const [col, row] of grp) {
    const [x, y] = hexCenter(col, row);
    sx += x;
    sy += y;
  }
  const [nx, ny] = LABEL_NUDGE[c.id] ?? [0, 0];
  const big = grp.length >= 40;
  const size = big ? 30 : grp.length >= 10 ? 17 : 14;
  const x = sx / grp.length + nx;
  const y = sy / grp.length + ny;
  const stroke = tok('paper');
  const words = c.name.toUpperCase().split(' ');
  const lines2 = big || words.length < 2 ? [words.join(' ')] : [words[0], words.slice(1).join(' ')];
  lines2.forEach((t, i) => {
    labels += `<text x="${x.toFixed(1)}" y="${(y + i * (size + 2) - ((lines2.length - 1) * (size + 2)) / 2).toFixed(1)}" text-anchor="middle" font-size="${size}" font-weight="700" letter-spacing="${big ? 3 : 1}" fill="${borderInk}" fill-opacity="0.8" stroke="${stroke}" stroke-opacity="0.55" stroke-width="3" paint-order="stroke">${t}</text>`;
  });
}
svg += `<g>${labels}</g>\n`;

// Places.
const markerFill = tok('hanko');
const markerInk = tok('paper-ink');
const markerPaper = tok('paper');
let marks = '';
let names = '';
const shortName = (n: string) => n.replace(/\s*\(.*\)$/, '').replace(/^Село (?=Прихован)/, '');
for (const p of places) {
  if (p.kind === 'country') continue;
  const [q, r] = p.hex;
  const col = q + (r - (r & 1)) / 2;
  const [x, y] = hexCenter(col, r);
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
  const label = shortName(p.name) || p.name;
  const onSea = p.country === 'sea';
  const right = (SIDE[p.id] ?? 'r') === 'r' && x < W - 260;
  names += `<text x="${(x + (right ? 11 : -11)).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}" font-size="12.5" font-weight="600" fill="${onSea ? tok('paper') : markerInk}" stroke="${onSea ? coastInk : markerPaper}" stroke-opacity="0.85" stroke-width="3" paint-order="stroke">${label}</text>`;
}
svg += `<g>${marks}</g>\n<g>${names}</g>\n`;

// Our own compass, bottom right (sea).
{
  const cx = 1830,
    cy = 930,
    R = 46;
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

// Legend, bottom centre (sea).
{
  const x0 = 1180,
    y0 = 1034;
  let l = `<rect x="${x0 - 12}" y="${y0 - 22}" width="650" height="38" rx="4" fill="${tok('ink-800')}" fill-opacity="0.88" stroke="${tok('ink-600')}"/>`;
  const item = (dx: number, mark: string, text: string) =>
    `${mark.replace(/__X__/g, String(x0 + dx))}<text x="${x0 + dx + 14}" y="${y0 + 4}" font-size="12.5" fill="${tok('text')}">${text}</text>`;
  l += item(
    0,
    `<circle cx="__X__" cy="${y0}" r="7" fill="${markerFill}" stroke="${markerPaper}" stroke-width="1.5"/>`,
    'приховане село',
  );
  l += item(
    130,
    `<rect x="__X__" y="${y0 - 6}" width="12" height="12" fill="${markerInk}" stroke="${markerPaper}" stroke-width="1.5" transform="translate(-6 0)"/>`,
    'місто',
  );
  l += item(
    195,
    `<circle cx="__X__" cy="${y0}" r="4.5" fill="${markerInk}" stroke="${markerPaper}" stroke-width="1.5"/>`,
    'місце',
  );
  l += item(
    255,
    `<polygon points="__X__,${y0 - 7} ${x0 + 255 + 7},${y0 + 5} ${x0 + 255 - 7},${y0 + 5}" fill="${markerInk}" stroke="${markerPaper}" stroke-width="1.5"/>`,
    'сховок',
  );
  l += item(
    325,
    `<line x1="${x0 + 325 - 12}" y1="${y0}" x2="${x0 + 325 + 8}" y2="${y0}" stroke="${tok('orange')}" stroke-width="4"/>`,
    'ігрова зона MVP',
  );
  l += item(
    470,
    `<line x1="${x0 + 470 - 12}" y1="${y0}" x2="${x0 + 470 + 8}" y2="${y0}" stroke="${tok('chakra')}" stroke-width="4"/>`,
    'річка',
  );
  svg += `<g>${l}</g>\n`;
}
svg += `</svg>\n`;

writeFileSync(join(dir, 'preview.svg'), svg);
await sharp(Buffer.from(svg), { density: 96 })
  .resize({ width: 1600 })
  .png({ compressionLevel: 9 })
  .toFile(join(dir, 'preview.png'));
console.log('colours used:');
for (const [c, why] of [...used].sort()) console.log(c, why);
void HEX_S;
void hexAt;

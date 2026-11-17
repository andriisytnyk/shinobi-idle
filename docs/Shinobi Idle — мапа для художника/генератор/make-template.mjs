// Builds a painting template of the hex map: the exact grid of the game (pointy-top, odd-r offset,
// axial q/r) at a chosen scale, countries, the playable land of the MVP with its terrain, and the places.
// Usage: node make-template.mjs <scale>   (scale 2 → 3840 px wide, the reference grid is 1920 px wide)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scale = Number(process.argv[2] ?? 2);
const world = JSON.parse(readFileSync(join(here, 'world-hex.json'), 'utf8'));
const firePlaces = JSON.parse(readFileSync(join(here, 'fire-places.json'), 'utf8'));
const worldPlaces = JSON.parse(readFileSync(join(here, 'places.json'), 'utf8'));
const refScale = (scale * 1920) / 1920;
const countries = JSON.parse(readFileSync(join(here, 'countries.json'), 'utf8'));

const g = world.grid;
const size = g.hexSizePx * scale; // centre to corner
const w = g.hexWidthPx * scale; // sqrt(3) * size
const width = Math.round(w * (g.cols + 0.5));
const height = Math.round(size * (1.5 * (g.rows - 1) + 2));

const colOf = (q, r) => q + (r - (r & 1)) / 2;
const centre = (q, r) => {
  const col = colOf(q, r);
  return { x: w * (col + 0.5 * (r & 1)) + w / 2, y: size * 1.5 * r + size };
};
const corners = (cx, cy, s = size) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return [cx + s * Math.cos(a), cy + s * Math.sin(a)];
  });
const poly = (pts) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

const PALETTE = ['#e8a07a', '#c7a26b', '#e3c66a', '#f0d64a', '#7d72c4', '#86c5c0', '#8fbf7a', '#d9b38c', '#9a9ab8', '#b8d07a', '#c79ac9', '#d88a9a', '#a8c8a0', '#e0b0c8', '#b0a080', '#c8b8e0', '#a0c0e0'];
const countryFill = new Map(countries.map((c, i) => [c.id, PALETTE[i % PALETTE.length]]));
const TERRAIN = { plains: '#b9d98a', forest: '#4f8a3c', hills: '#b08a5a', river: '#5aa0d8', lake: '#3f86c8', coast: '#e8d49a', road: '#c9b48a', settlement: '#d9774a' };

const byKey = new Map(world.hexes.map((h) => [`${h.q},${h.r}`, h]));
const NEIGHBOURS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
// Edge i of a pointy-top hex (corners i and i+1) faces neighbour EDGE_DIR[i].
const EDGE_DIR = [[0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1], [1, 0]];

let cells = '';
let borders = '';
let labels = '';
for (const h of world.hexes) {
  const { x, y } = centre(h.q, h.r);
  const pts = corners(x, y);
  const fill = h.playable ? TERRAIN[h.terrain] ?? '#ffffff' : (h.country === 'sea' ? '#8ec0ea' : countryFill.get(h.country) ?? '#eeeeee');
  const op = h.playable ? 0.85 : 0.8;
  cells += `<polygon points="${poly(pts)}" fill="${fill}" fill-opacity="${op}" stroke="#2a2a2a" stroke-width="${1.1 * scale}"/>`;
  if (h.playable) {
    cells += `<polygon points="${poly(corners(x, y, size * 0.97))}" fill="none" stroke="#000" stroke-width="${2.4 * scale}"/>`;
  }
  // Country borders: the edges whose neighbour is another country (or outside the grid).
  EDGE_DIR.forEach(([dq, dr], i) => {
    const n = byKey.get(`${h.q + dq},${h.r + dr}`);
    if (!n || n.country === h.country) return;
    const [a, b] = [pts[i], pts[(i + 1) % 6]];
    borders += `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="#b0302a" stroke-width="${2 * scale}" stroke-linecap="round"/>`;
  });
  labels += `<text x="${x.toFixed(1)}" y="${(y + size * 0.62).toFixed(1)}" font-size="${5 * scale}" text-anchor="middle" fill="#222">${h.q},${h.r}</text>`;
}
void NEIGHBOURS;

let marks = '';
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const label = (x, y, text, size, colour) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" text-anchor="middle" fill="${colour}" stroke="#fff" stroke-width="${2 * scale}" paint-order="stroke">${esc(text)}</text>`;
// Points of the author's full map: the exact spot on the reference picture (referencePx, 1920 px wide), black.
const fromReference = new Set();
let countryNames = '';
for (const p of worldPlaces) {
  const [rx, ry] = p.referencePx;
  const x = rx * refScale;
  const y = ry * refScale;
  if (p.kind === 'country') {
    countryNames += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${14 * scale}" font-weight="700" text-anchor="middle" fill="#6a1f1a" fill-opacity="0.8" stroke="#fff" stroke-width="${3 * scale}" paint-order="stroke">${esc(p.name)}</text>`;
    continue;
  }
  fromReference.add(p.id);
  marks += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${4.5 * scale}" fill="#000" stroke="#fff" stroke-width="${1.2 * scale}"/>`;
  marks += label(x, y - 7 * scale, p.name, 8 * scale, '#000');
}
// Places added for the MVP slice inside the Land of Fire (not on the reference picture): blue, at the centre of their hex.
for (const p of firePlaces) {
  if (fromReference.has(p.id)) continue;
  const [q, r] = p.hex;
  if (!byKey.has(`${q},${r}`)) throw new Error(`place ${p.id} off the grid`);
  const { x, y } = centre(q, r);
  marks += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${3.5 * scale}" fill="#1f5fbf" stroke="#fff" stroke-width="${scale}"/>`;
  marks += label(x, y + 11 * scale, p.previewLabel ?? p.name, 6.5 * scale, '#1f5fbf');
}
// Countries without a label on the reference picture: at the middle of their hexes.
const labelled = new Set(worldPlaces.filter((p) => p.kind === 'country').map((p) => p.country ?? p.id));
for (const c of countries) {
  if (labelled.has(c.id)) continue;
  const own = world.hexes.filter((h) => h.country === c.id);
  if (own.length === 0) continue;
  const cx = own.reduce((s, h) => s + centre(h.q, h.r).x, 0) / own.length;
  const cy = own.reduce((s, h) => s + centre(h.q, h.r).y, 0) / own.length;
  countryNames += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" font-size="${11 * scale}" font-weight="700" text-anchor="middle" fill="#6a1f1a" fill-opacity="0.6" stroke="#fff" stroke-width="${3 * scale}" paint-order="stroke">${esc(c.name)}</text>`;
}
const legend = `<g transform="translate(${20 * scale},${height - 70 * scale})"><rect width="${330 * scale}" height="${60 * scale}" fill="#fff" fill-opacity="0.9" stroke="#333"/>
<circle cx="${14 * scale}" cy="${16 * scale}" r="${4.5 * scale}" fill="#000"/><text x="${26 * scale}" y="${20 * scale}" font-size="${9 * scale}">Точка з твоєї мапи — точне місце на малюнку</text>
<circle cx="${14 * scale}" cy="${32 * scale}" r="${3.5 * scale}" fill="#1f5fbf"/><text x="${26 * scale}" y="${36 * scale}" font-size="${9 * scale}" fill="#1f5fbf">Місце зрізу MVP (центр його гекса)</text>
<line x1="${6 * scale}" y1="${48 * scale}" x2="${22 * scale}" y2="${48 * scale}" stroke="#b0302a" stroke-width="${2 * scale}"/><text x="${26 * scale}" y="${52 * scale}" font-size="${9 * scale}">Межа країни; блакитні гекси — море; обведені чорним — зріз MVP</text></g>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif">
<rect width="100%" height="100%" fill="#ffffff"/>
<g id="hexes">${cells}</g>
<g id="borders">${borders}</g>
<g id="coords">${labels}</g>
<g id="countries">${countryNames}</g>
<g id="places">${marks}</g>
${legend}
</svg>`;
writeFileSync(join(here, `map-template-${width}x${height}.svg`), svg);

// The grid alone (thin outlines, transparent) to lay over a finished painting and check the fit.
const gridOnly = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${world.hexes
  .map((h) => {
    const { x, y } = centre(h.q, h.r);
    return `<polygon points="${poly(corners(x, y))}" fill="none" stroke="#000" stroke-opacity="${h.playable ? 0.95 : 0.8}" stroke-width="${(h.playable ? 2.2 : 1.2) * scale}"/>`;
  })
  .join('')}</svg>`;
writeFileSync(join(here, `map-grid-overlay-${width}x${height}.svg`), gridOnly);


// ---------- Points of interest of the whole world (world-pois.json): numbered markers + short names.
const pois = JSON.parse(readFileSync(join(here, 'world-pois.json'), 'utf8'));
const placeById = new Map(worldPlaces.map((p) => [p.id, p]));
const rects = [];
const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const overlapArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const fs1 = 6.5 * scale; // label font
const tw = (t) => t.length * fs1 * 0.56 + 4 * scale;
const shorten = (n) => {
  let t = n.replace(/^Селище Прихованого (.*?)( \(.*\))?$/, 'Прих. $1').replace(/ \(.*\)$/, '');
  return t.length > 26 ? t.slice(0, 25) + '…' : t;
};
const COL = { 'author-map': '#000000', mvp: '#1f5fbf', canon: '#1e8a3c', invented: '#e07a10' };
const R = 6.5 * scale;
const pts = pois.map((p) => {
  let x, y;
  if (p.source === 'author-map') [x, y] = placeById.get(p.id).referencePx.map((v) => v * refScale);
  else ({ x, y } = centre(p.hex[0], p.hex[1]));
  return { ...p, x, y };
});
// markers first so that labels avoid every marker
for (const p of pts) rects.push({ x0: p.x - R, y0: p.y - R, x1: p.x + R, y1: p.y + R });
for (const c of worldPlaces.filter((q) => q.kind === 'country')) {
  const w2 = c.name.length * 14 * scale * 0.6 / 2;
  rects.push({ x0: c.referencePx[0] * refScale - w2, x1: c.referencePx[0] * refScale + w2, y0: c.referencePx[1] * refScale - 14 * scale, y1: c.referencePx[1] * refScale + 4 * scale });
}
let poiMarks = '';
let poiLabels = '';
for (const p of pts) {
  const t = shorten(p.name);
  const w3 = tw(t), h3 = fs1 + 2 * scale;
  const g = R + 2 * scale;
  const cands = [
    [p.x + g, p.y + h3 / 3], [p.x - g - w3, p.y + h3 / 3], [p.x - w3 / 2, p.y + R + h3], [p.x - w3 / 2, p.y - R - 2 * scale],
    [p.x + g, p.y + R + h3 * 0.9], [p.x - g - w3, p.y + R + h3 * 0.9], [p.x + g, p.y - R], [p.x - g - w3, p.y - R],
    [p.x - w3 / 2, p.y + R + 2 * h3], [p.x - w3 / 2, p.y - R - h3 - 2 * scale], [p.x + g + 2 * R, p.y + 2 * h3], [p.x - g - w3 - 2 * R, p.y + 2 * h3],
  ];
  let best = null;
  for (const [lx, ly] of cands) {
    const rc = { x0: lx, y0: ly - fs1, x1: lx + w3, y1: ly + 2 * scale };
    let ov = 0;
    for (const o of rects) ov += overlapArea(rc, o);
    if (rc.x0 < 0 || rc.x1 > width || rc.y0 < 0 || rc.y1 > height) ov += 1e6;
    if (!best || ov < best.ov) best = { ov, lx, ly, rc };
    if (ov === 0) break;
  }
  rects.push(best.rc);
  poiLabels += `<text x="${best.lx.toFixed(1)}" y="${best.ly.toFixed(1)}" font-size="${fs1}" fill="${COL[p.source]}" stroke="#fff" stroke-width="${2.2 * scale}" paint-order="stroke" font-weight="600">${esc(t)}</text>`;
  poiMarks += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${R}" fill="${COL[p.source]}" stroke="#fff" stroke-width="${1.3 * scale}"/><text x="${p.x.toFixed(1)}" y="${(p.y + fs1 * 0.35).toFixed(1)}" font-size="${(p.n > 99 ? 5.6 : 6.5) * scale}" font-weight="700" text-anchor="middle" fill="#fff">${p.n}</text>`;
}
const poiLegend = `<g transform="translate(${width - 360 * scale},${height - 100 * scale})"><rect width="${340 * scale}" height="${90 * scale}" fill="#fff" fill-opacity="0.92" stroke="#333"/>
<circle cx="${14 * scale}" cy="${16 * scale}" r="${6 * scale}" fill="#000"/><text x="${28 * scale}" y="${20 * scale}" font-size="${9 * scale}">Точка з твоєї мапи (точне місце на малюнку), ${pois.filter((p) => p.source === 'author-map').length}</text>
<circle cx="${14 * scale}" cy="${34 * scale}" r="${6 * scale}" fill="#1f5fbf"/><text x="${28 * scale}" y="${38 * scale}" font-size="${9 * scale}" fill="#1f5fbf">Місце зрізу MVP у Країні Вогню (центр гекса), ${pois.filter((p) => p.source === 'mvp').length}</text>
<circle cx="${14 * scale}" cy="${52 * scale}" r="${6 * scale}" fill="#1e8a3c"/><text x="${28 * scale}" y="${56 * scale}" font-size="${9 * scale}" fill="#1e8a3c">Нова точка за каноном, ${pois.filter((p) => p.source === 'canon').length}</text>
<circle cx="${14 * scale}" cy="${70 * scale}" r="${6 * scale}" fill="#e07a10"/><text x="${28 * scale}" y="${74 * scale}" font-size="${9 * scale}" fill="#e07a10">Нова вигадана точка, ${pois.filter((p) => p.source === 'invented').length}</text>
<text x="${14 * scale}" y="${86 * scale}" font-size="${7 * scale}" fill="#555">Номер у колі = номер у artist-brief.md</text></g>`;
const poiSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif">
<rect width="100%" height="100%" fill="#ffffff"/>
<g>${cells}</g><g>${borders}</g><g>${countryNames}</g><g>${poiLabels}</g><g>${poiMarks}</g>${poiLegend}
</svg>`;
writeFileSync(join(here, `map-pois-${width}x${height}.svg`), poiSvg);

const require = createRequire(join(here, '../../../packages/content/package.json'));
const sharp = require('sharp');
await sharp(Buffer.from(svg)).png().toFile(join(here, `map-template-${width}x${height}.png`));
await sharp(Buffer.from(poiSvg)).png().toFile(join(here, `map-pois-${width}x${height}.png`));
await sharp(Buffer.from(gridOnly)).png().toFile(join(here, `map-grid-overlay-${width}x${height}.png`));
console.log({ width, height, hexSize: size, hexWidth: w });

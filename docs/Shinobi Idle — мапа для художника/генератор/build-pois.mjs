// Builds world-pois.json from the author's places, the MVP places and the new points.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXISTING } from './pois-data-existing.mjs';
import { NEW } from './pois-data-new.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const J = (f) => JSON.parse(readFileSync(join(here, f), 'utf8'));
const world = J('world-hex.json'), places = J('places.json').filter((p) => p.kind !== 'country'), fire = J('fire-places.json');
export const ORDER = ['core:fire','core:earth','core:wind','core:lightning','core:water','core:waves','core:forests','core:rivers','core:rain','core:waterfall','core:disputed','core:sound','core:steam','core:frost','core:rock','core:far-east','sea'];
const hexCountry = new Map(world.hexes.map((h) => [`${h.q},${h.r}`, h.country]));
const out = [];
const seen = new Set();
const used = new Map();
const add = (p) => {
  if (seen.has(p.id)) throw new Error('dup id ' + p.id);
  seen.add(p.id);
  const k = p.hex.join(',');
  if (used.has(k)) throw new Error(`hex ${k} used by ${used.get(k)} and ${p.id}`);
  used.set(k, p.id);
  if (hexCountry.get(k) !== p.country) throw new Error(`${p.id} hex ${k} is ${hexCountry.get(k)}, not ${p.country}`);
  out.push(p);
};
for (const p of places) {
  const m = EXISTING[p.id]; if (!m) throw new Error('no meta ' + p.id);
  add({ id: p.id, name: p.name, country: p.country, hex: p.hex, source: 'author-map', canonNames: m[1], poiKind: m[0], visual: m[2], references: m[3], origin: /^[A-Z]/.test(m[1]) && !/позначка/.test(m[1]) ? 'canon' : 'map' });
}
for (const p of fire) {
  if (seen.has(p.id)) continue;
  const m = EXISTING[p.id]; if (!m) throw new Error('no meta ' + p.id);
  add({ id: p.id, name: p.name, country: 'core:fire', hex: p.hex, source: 'mvp', canonNames: m[1], poiKind: m[0], visual: m[2], references: p.invented ? m[3] : m[3], origin: p.invented ? 'invented' : 'canon' });
}
for (const [id, name, country, q, r, source, cn, kind, visual, refs] of NEW) {
  add({ id, name, country, hex: [q, r], source, canonNames: cn, poiKind: kind, visual, references: source === 'invented' ? refs : refs, origin: source });
}
// number: by country order, then author-map, mvp, canon, invented; then by row/col
const rank = { 'author-map': 0, mvp: 1, canon: 2, invented: 3 };
out.sort((a, b) => ORDER.indexOf(a.country) - ORDER.indexOf(b.country) || rank[a.source] - rank[b.source] || a.hex[1] - b.hex[1] || a.hex[0] - b.hex[0]);
out.forEach((p, i) => { p.n = i + 1; });
const final = out.map(({ n, id, name, country, hex, source, canonNames, poiKind, visual, references, origin }) => ({ n, id, name, country, hex, source, origin, canonNames, poiKind, visual, references }));
writeFileSync(join(here, 'world-pois.json'), JSON.stringify(final, null, 2));
const cnt = {};
for (const p of final) { const c = (cnt[p.country] ??= { total: 0, canon: 0, invented: 0, map: 0 }); c.total++; if (p.origin === 'canon') c.canon++; else if (p.origin === 'invented') c.invented++; else c.map++; }
console.table(cnt);
console.log(final.length);

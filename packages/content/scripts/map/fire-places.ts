// Resolves the hexes of FIRE_PLACES, validates them against the map data and writes fire-places.json.
// Prints the density statistics that the README quotes.
// Usage: pnpm --filter @shinobi/content exec tsx scripts/map/fire-places.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hexAt, neighbours } from './grid.ts';
import { FIRE_PLACES } from './fire-places-data.ts';

const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/Shinobi Idle — MVP — зріз і баланс/map',
);
const read = <T>(f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T;

interface HexRec {
  q: number;
  r: number;
  country: string;
  playable?: boolean;
  terrain?: string;
}
const world = read<{ hexes: HexRec[] }>('world-hex.json');
const cells = read<{ cell: string; name: string; hex: [number, number] }[]>('slice-cells.json');
const places = read<{ id: string; hex: [number, number] }[]>('places.json');
const slice = JSON.parse(readFileSync(join(dir, '../slice.json'), 'utf8')) as {
  regions: { id: string; cells: (string | null)[][] }[];
};

const colRow = (q: number, r: number): [number, number] => [q + (r - (r & 1)) / 2, r];
const k = (c: number, r: number) => `${c},${r}`;
const playable = new Map<string, HexRec>();
for (const h of world.hexes) if (h.playable) playable.set(k(...colRow(h.q, h.r)), h);

const cellByHex = new Map<string, (typeof cells)[number]>();
for (const c of cells) cellByHex.set(k(...colRow(...c.hex)), c);
const sliceNote = (id: string): string | null => {
  const [region = '', n = '0'] = id.split('#');
  const row = slice.regions.find((x) => x.id === region)?.cells[Number(n) - 1];
  return row?.[2] ?? null;
};

const out: unknown[] = [];
const usedHex = new Map<string, string>(); // hex -> place id
const absorbed = new Set<string>();
for (const p of FIRE_PLACES) {
  let col: number;
  let row: number;
  let absorbs: string | null = null;
  if ('ref' in p.at) {
    const ref = places.find((x) => x.id === (p.at as { ref: string }).ref);
    if (!ref) throw new Error(`${p.id}: unknown places.json id`);
    [col, row] = colRow(...ref.hex);
    const onCell = cellByHex.get(k(col, row));
    if (onCell) {
      absorbs = onCell.cell;
      absorbed.add(onCell.cell);
    }
  } else if ('cell' in p.at) {
    const cell = cells.find((x) => x.cell === (p.at as { cell: string }).cell);
    if (!cell) throw new Error(`${p.id}: unknown cell`);
    [col, row] = colRow(...cell.hex);
    absorbs = cell.cell;
    if (absorbed.has(cell.cell)) throw new Error(`${p.id}: cell ${cell.cell} absorbed twice`);
    absorbed.add(cell.cell);
  } else {
    ({ col, row } = p.at);
  }
  const hexKey = k(col, row);
  if (!playable.has(hexKey)) throw new Error(`${p.id}: hex ${hexKey} is not playable`);
  if (usedHex.has(hexKey)) throw new Error(`${p.id}: hex shared with ${usedHex.get(hexKey)}`);
  usedHex.set(hexKey, p.id);
  if ('col' in p.at && cellByHex.has(hexKey))
    throw new Error(`${p.id}: sits on a slice cell without absorbing it`);
  if (p.status === 'canon' && p.sources.length === 0)
    throw new Error(`${p.id}: canon without source`);
  if (p.status === 'invented' && p.sources.length > 0)
    throw new Error(`${p.id}: invented with source`);
  if (!p.era) throw new Error(`${p.id}: no era`);
  const h = hexAt(col, row);
  const cellInfo = cellByHex.get(hexKey);
  out.push({
    id: p.id,
    name: p.name,
    kind: p.kind,
    role: p.role,
    hex: [h.q, h.r],
    terrain: playable.get(hexKey)?.terrain ?? null,
    previewLabel: p.short ?? p.name,
    labelled: p.label,
    description: p.description,
    invented: p.status === 'invented',
    status: p.status,
    era: p.era,
    sources: p.sources.map(([label, url]) => ({ label, url })),
    placeRef: 'ref' in p.at ? p.at.ref : null,
    absorbsCell: absorbs,
    sliceCellName: cellInfo?.name ?? null,
    sliceNote: absorbs ? sliceNote(absorbs) : null,
    note: p.note ?? null,
  });
}
writeFileSync(join(dir, 'fire-places.json'), JSON.stringify(out, null, 2) + '\n');

// ---- density statistics ---------------------------------------------------------------------------
const sig = new Set<string>([...cellByHex.keys(), ...usedHex.keys()]);
// Konoha, Tanzaku, Bamboo village and Hell Valley are in FIRE_PLACES through `ref`, so `sig` already has them.
const total = playable.size;
let adjSum = 0;
let adjMax = 0;
for (const key of playable.keys()) {
  const [c = 0, r = 0] = key.split(',').map(Number);
  const n = neighbours(c, r).filter((x) => x && sig.has(k(x[0], x[1]))).length;
  adjSum += n;
  adjMax = Math.max(adjMax, n);
}
// Longest run of road hexes without a significant hex (longest simple path in the induced road graph).
const isRoad = (key: string) => {
  const t = playable.get(key)?.terrain;
  return (t === 'road' || t === 'settlement') && !sig.has(key);
};
const roadKeys = [...playable.keys()].filter(isRoad);
const adj = (key: string) => {
  const [c = 0, r = 0] = key.split(',').map(Number);
  return neighbours(c, r)
    .filter((x): x is [number, number] => x !== null)
    .map((x) => k(x[0], x[1]))
    .filter(isRoad);
};
let longest = 0;
let longestPath: string[] = [];
const dfs = (key: string, seen: string[]) => {
  if (seen.length > longest) {
    longest = seen.length;
    longestPath = [...seen];
  }
  for (const n of adj(key)) if (!seen.includes(n)) dfs(n, [...seen, n]);
};
for (const key of roadKeys) dfs(key, [key]);
const byStatus = (s: string) => FIRE_PLACES.filter((p) => p.status === s).length;
const cellOnly = cells.filter((c) => !absorbed.has(c.cell)).length;
console.log('playable hexes:', total);
console.log(
  'slice cells:',
  cells.length,
  '(with a place record:',
  absorbed.size,
  ', cell only:',
  cellOnly + ')',
);
console.log(
  'place records:',
  FIRE_PLACES.length,
  'canon',
  byStatus('canon'),
  'invented',
  byStatus('invented'),
  'map-only',
  byStatus('map-only'),
);
console.log('place records on fresh hexes:', FIRE_PLACES.filter((p) => 'col' in p.at).length);
console.log(
  'significant hexes:',
  sig.size,
  `(${((100 * sig.size) / total).toFixed(1)}% of ${total})`,
);
console.log(
  'mean significant neighbours per playable hex:',
  (adjSum / total).toFixed(2),
  'max',
  adjMax,
);
console.log('longest empty road stretch:', longest, 'hexes', longestPath.join(' '));
console.log('mean spacing: one significant hex per', (total / sig.size).toFixed(1), 'hexes');

// Classifies a hex grid laid over the reference world map into sea / country and writes the data files.
// Usage: pnpm --filter @shinobi/content exec tsx scripts/map/classify.ts <path-to-reference-image>
// The reference image is read only; nothing derived from its pixels is written except the classification.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assignCountries,
  classifyGrid,
  loadImage,
  measurePalette,
  neighbourPass,
  outlierPass,
} from './classify-core.ts';
import { COLS, HEX_S, HEX_W, IMAGE_W, ROWS, hexAt, hexCenter, hexOfPixel } from './grid.ts';
import { COUNTRIES } from './world-data.ts';
import { PLACES } from './places.ts';
import { buildPlayable } from './mvp.ts';
import { readFileSync } from 'node:fs';

const COUNTRY_OF_LABEL: Record<string, string> = {
  'core:land-of-fire': 'core:fire',
  'core:land-of-earth': 'core:earth',
  'core:land-of-wind': 'core:wind',
  'core:land-of-lightning': 'core:lightning',
  'core:land-of-water': 'core:water',
  'core:land-of-waves': 'core:waves',
  'core:land-of-forests': 'core:forests',
  'core:land-of-rivers': 'core:rivers',
  'core:disputed-lands': 'core:disputed',
  'core:land-of-sound': 'core:sound',
  'core:land-of-steam': 'core:steam',
  'core:land-of-frost': 'core:frost',
};

const outDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/Shinobi Idle — MVP — зріз і баланс/map',
);

async function main() {
  const refPath = process.argv[2];
  if (!refPath) throw new Error('usage: classify.ts <path-to-reference-image>');
  const img = await loadImage(refPath);
  const palette = measurePalette(img);
  const grid = classifyGrid(img, palette);
  const filled = neighbourPass(grid) + outlierPass(grid);
  const warnings = assignCountries(grid);
  for (const w of warnings) console.warn('warn:', w);
  console.log('palette:', palette.map((p) => `${p.cls}=${p.colour.join(',')}`).join('  '));
  console.log('filled from neighbours:', filled);

  const axial = (col: number, row: number) => {
    const h = hexAt(col, row);
    return `${h.q},${h.r}`;
  };
  const byAxial = new Map<string, { col: number; row: number; country: string }>();
  for (const line of grid) for (const h of line) byAxial.set(axial(h.col, h.row), h);

  // Places: hex under the pixel; country-kind places are moved to the nearest hex of their country.
  const places = PLACES.map((p) => {
    let hex = hexOfPixel(p.px[0], p.px[1])!;
    const want = COUNTRY_OF_LABEL[p.id];
    if (want) {
      let best = Infinity;
      for (const line of grid)
        for (const h of line) {
          if (h.country !== want) continue;
          const [cx, cy] = hexCenter(h.col, h.row);
          const d = (cx - p.px[0]) ** 2 + (cy - p.px[1]) ** 2;
          if (d < best) {
            best = d;
            hex = hexAt(h.col, h.row);
          }
        }
    }
    return {
      id: p.id,
      name: p.name,
      kind: p.kind,
      hex: [hex.q, hex.r] as [number, number],
      country: grid[hex.row][hex.col].country,
      referencePx: p.px,
      referenceLabel: p.refLabel,
      nameSource: p.source,
    };
  });

  const play = buildPlayable((c, r) => grid[r][c].country, COLS);
  const mvp = new Set(play.hexes);
  const TERRAIN = play.terrain;
  const slice = JSON.parse(readFileSync(join(outDir, '../slice.json'), 'utf8')) as {
    regions: { id: string; cells: [string][] }[];
  };
  const hexLines: string[] = [];
  const counts: Record<string, number> = {};
  for (const line of grid) {
    for (const h of line) {
      const a = axial(h.col, h.row);
      counts[h.country] = (counts[h.country] ?? 0) + 1;
      const t = TERRAIN.get(a);
      const parts = [`"q":${hexAt(h.col, h.row).q}`, `"r":${h.row}`, `"country":"${h.country}"`];
      if (mvp.has(a)) {
        parts.push(`"playable":true`);
        if (t) parts.push(`"terrain":"${t}"`);
      }
      hexLines.push(`    {${parts.join(',')}}`);
    }
  }
  const world =
    `{\n  "grid": {\n    "orientation": "pointy-top",\n    "layout": "odd-r offset; axial q = col - (row - (row & 1)) / 2, r = row",\n` +
    `    "cols": ${COLS},\n    "rows": ${ROWS},\n    "referenceWidthPx": ${IMAGE_W},\n    "hexWidthPx": ${HEX_W.toFixed(3)},\n    "hexSizePx": ${HEX_S.toFixed(3)}\n  },\n` +
    `  "hexes": [\n${hexLines.join(',\n')}\n  ]\n}\n`;

  const countries =
    JSON.stringify(
      COUNTRIES.map((c) => ({ ...c, hexes: counts[c.id] ?? 0 })),
      null,
      2,
    ) + '\n';
  const placesJson = JSON.stringify(places, null, 2) + '\n';
  const cellsJson =
    JSON.stringify(
      play.cells.map((c) => ({
        cell: `${c.region}#${c.index}`,
        region: c.region,
        name: slice.regions.find((x) => x.id === c.region)!.cells[c.index - 1][0],
        hex: [c.q, c.r],
        why: c.why,
      })),
      null,
      2,
    ) + '\n';

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'world-hex.json'), world);
  writeFileSync(join(outDir, 'countries.json'), countries);
  writeFileSync(join(outDir, 'places.json'), placesJson);
  writeFileSync(join(outDir, 'slice-cells.json'), cellsJson);
  console.log('hex counts:', JSON.stringify(counts));
  console.log('playable hexes:', mvp.size);
}

await main();

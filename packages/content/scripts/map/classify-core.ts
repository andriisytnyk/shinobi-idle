// Classification core: image sampling, palette measurement, neighbour pass, region assignment.
import sharp from 'sharp';
import {
  COMPASS,
  DIRECT_CLASS_COUNTRY,
  FORCED,
  ISLETS,
  MASKS,
  PALETTE_RECTS,
  REGIONS,
  SEA,
  type Pt,
  type RGB,
} from './world-data.ts';
import { at, COLS, HEX_S, ROWS, hexCenter, hexOfPixel, neighbours } from './grid.ts';

export interface Image {
  w: number;
  h: number;
  px: (x: number, y: number) => RGB;
}

export async function loadImage(path: string): Promise<Image> {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  return {
    w,
    h,
    px: (x, y) => {
      const xi = Math.min(w - 1, Math.max(0, Math.round(x)));
      const yi = Math.min(h - 1, Math.max(0, Math.round(y)));
      const i = (yi * w + xi) * 3;
      return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
    },
  };
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? at(s, m) : Math.round((at(s, m - 1) + at(s, m)) / 2);
};

export function medianColour(img: Image, rects: [number, number, number, number][]): RGB {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const c = img.px(x, y);
        r.push(c[0]);
        g.push(c[1]);
        b.push(c[2]);
      }
    }
  }
  return [median(r), median(g), median(b)];
}

export function measurePalette(img: Image): { cls: string; colour: RGB }[] {
  return PALETTE_RECTS.map((p) => ({ cls: p.cls, colour: medianColour(img, p.rects) }));
}

/** Colour distance that weighs hue (r-b, g-b) fully and brightness lightly: the lands differ in hue, while the paint brightness drifts. */
const dist2 = (a: RGB, b: RGB) => {
  const la = 0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2];
  const lb = 0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2];
  return (
    (a[0] - a[2] - (b[0] - b[2])) ** 2 +
    (a[1] - a[2] - (b[1] - b[2])) ** 2 +
    (0.35 * (la - lb)) ** 2
  );
};

/** Ink (outlines, text, icons, brown borders), label halos, red label text: not terrain. */
function isNotTerrain(c: RGB): boolean {
  const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  if (lum < 90) return true; // black text, icons, dark brown borders
  if (lum < 110 && c[0] - c[2] > 30 && c[0] > c[1]) return true; // lighter edge of the brown border line
  if (c[0] > 225 && c[1] > 225 && c[2] > 225) return true; // white label halos
  if (c[0] > 170 && c[1] < 60 && c[2] < 60) return true; // red label text
  if (lum > 150 && Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) < 14) return true; // grey halo of labels
  return false;
}

export function inPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = at(poly, i);
    const [xj, yj] = at(poly, j);
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distToPoly(p: Pt, poly: Pt[]): number {
  if (inPoly(p, poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++)
    d = Math.min(d, distToSeg(p, at(poly, i), at(poly, (i + 1) % poly.length)));
  return d;
}

export interface HexResult {
  col: number;
  row: number;
  /** colour class from sampling, or "unknown" before the neighbour pass */
  cls: string;
  country: string; // "sea" or country id
  filled: boolean; // taken from the neighbours
}

/** Sample offsets inside a hex in units of the hex size: centre, inner ring, outer ring. */
const SAMPLE_OFFSETS: Pt[] = (() => {
  const o: Pt[] = [[0, 0]];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    o.push([0.35 * Math.cos(a), 0.35 * Math.sin(a)]);
    o.push([0.65 * Math.cos(a), 0.65 * Math.sin(a)]);
  }
  return o;
})();

export function classifyGrid(img: Image, palette: { cls: string; colour: RGB }[]): HexResult[][] {
  const grid: HexResult[][] = [];
  for (let row = 0; row < ROWS; row++) {
    const line: HexResult[] = [];
    for (let col = 0; col < COLS; col++) {
      const [cx, cy] = hexCenter(col, row);
      const underCompass = Math.hypot(cx - COMPASS.c[0], cy - COMPASS.c[1]) < COMPASS.r;
      const votes = new Map<string, number>();
      let valid = 0;
      if (!underCompass) {
        for (const [ox, oy] of SAMPLE_OFFSETS) {
          const x = cx + ox * HEX_S;
          const y = cy + oy * HEX_S;
          if (MASKS.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) continue;
          const c = img.px(x, y);
          if (isNotTerrain(c)) continue;
          let best = '';
          let bd = Infinity;
          for (const p of palette) {
            const d = dist2(c, p.colour);
            if (d < bd) {
              bd = d;
              best = p.cls;
            }
          }
          valid++;
          votes.set(best, (votes.get(best) ?? 0) + 1);
        }
      }
      let cls = 'unknown';
      if (valid >= 5) {
        // The median colour of a hex that straddles a coast is a blend that matches neither class, so
        // the nearest class of every valid sample votes instead. Sea wins only with a clear majority:
        // a hex with a real piece of land in it is land, which keeps small islands on the grid.
        const seaShare = (votes.get('sea') ?? 0) / valid;
        if (seaShare > 0.6) cls = 'sea';
        else {
          let bc = '';
          let bn = -1;
          for (const [k, n] of [...votes].sort((a, b) => a[0].localeCompare(b[0]))) {
            if (k !== 'sea' && n > bn) {
              bn = n;
              bc = k;
            }
          }
          cls = bc || 'sea';
        }
      }
      line.push({ col, row, cls, country: '', filled: false });
    }
    grid.push(line);
  }
  return grid;
}

/** Fill unknown hexes (covered by labels, icons, the compass) with the majority class of known neighbours. */
export function neighbourPass(grid: HexResult[][]): number {
  let filled = 0;
  for (let guard = 0; guard < 20; guard++) {
    const updates: [number, number, string][] = [];
    for (const line of grid) {
      for (const h of line) {
        if (h.cls !== 'unknown') continue;
        const votes = new Map<string, number>();
        for (const n of neighbours(h.col, h.row)) {
          if (!n) continue;
          const c = cellAt(grid, n[0], n[1]).cls;
          if (c !== 'unknown') votes.set(c, (votes.get(c) ?? 0) + 1);
        }
        if (votes.size === 0) continue;
        let bc = '';
        let bn = -1;
        for (const [k, n] of [...votes].sort((a, b) => a[0].localeCompare(b[0]))) {
          if (n > bn) {
            bn = n;
            bc = k;
          }
        }
        updates.push([h.col, h.row, bc]);
      }
    }
    if (updates.length === 0) break;
    for (const [c, r, cls] of updates) {
      cellAt(grid, c, r).cls = cls;
      cellAt(grid, c, r).filled = true;
      filled++;
    }
  }
  return filled;
}

/**
 * A hex of a flat-colour land class (fire, earth, wind, lightning) with no neighbour of the same class is a
 * sampling artefact (a coast blended with the brown border, a label edge): it takes the majority class of its
 * neighbours. Neutral lands are not touched, because single-hex islands are real there.
 */
export function outlierPass(grid: HexResult[][]): number {
  let changed = 0;
  const updates: [number, number, string][] = [];
  for (const line of grid) {
    for (const h of line) {
      if (!DIRECT_CLASS_COUNTRY[h.cls]) continue;
      const votes = new Map<string, number>();
      let same = 0;
      for (const n of neighbours(h.col, h.row)) {
        if (!n) continue;
        const c = cellAt(grid, n[0], n[1]).cls;
        if (c === h.cls) same++;
        else votes.set(c, (votes.get(c) ?? 0) + 1);
      }
      if (same > 0 || votes.size === 0) continue;
      let bc = '';
      let bn = -1;
      for (const [k, n] of [...votes].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (n > bn) {
          bn = n;
          bc = k;
        }
      }
      updates.push([h.col, h.row, bc]);
    }
  }
  for (const [c, r, cls] of updates) {
    cellAt(grid, c, r).cls = cls;
    cellAt(grid, c, r).filled = true;
    changed++;
  }
  return changed;
}

/** Turn colour classes into countries: direct classes, neutral lands through hand-drawn polygons. */
export function assignCountries(grid: HexResult[][]): string[] {
  const warnings: string[] = [];
  for (const line of grid) {
    for (const h of line) {
      const [cx, cy] = hexCenter(h.col, h.row);
      const forced = FORCED.find((f) => inPoly([cx, cy], f.poly));
      if (forced) {
        h.country = forced.id;
        continue;
      }
      if (h.cls === SEA) {
        h.country = 'sea';
      } else if (DIRECT_CLASS_COUNTRY[h.cls]) {
        h.country = DIRECT_CLASS_COUNTRY[h.cls] ?? '';
      } else {
        let best = '';
        let bd = Infinity;
        for (const r of REGIONS) {
          const d = distToPoly([cx, cy], r.poly);
          if (d < bd) {
            bd = d;
            best = r.id;
          }
        }
        h.country = best;
        if (bd > HEX_S * 1.2)
          warnings.push(
            `neutral hex (${h.col},${h.row}) at (${Math.round(cx)},${Math.round(cy)}) is ${Math.round(bd)}px from the nearest polygon -> ${best}`,
          );
      }
    }
  }
  for (const isl of ISLETS) {
    const h = hexOfPixel(isl.at[0], isl.at[1]);
    if (h) cellAt(grid, h.col, h.row).country = isl.id;
  }
  return warnings;
}

export function cellAt(grid: HexResult[][], col: number, row: number): HexResult {
  return at(at(grid, row), col);
}

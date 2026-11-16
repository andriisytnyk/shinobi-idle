// Hex grid geometry shared by the classifier and the preview.
// Pointy-top hexes, "odd-r" offset layout (odd rows shifted half a hex to the right).
// Axial coordinates: q = col - (row - (row & 1)) / 2, r = row.

export const IMAGE_W = 1920; // nominal reference width the grid is fitted to
export const COLS = 42;
export const ROWS = 27;
/** Hex width (flat-to-flat) in reference pixels: 42 columns plus the half-hex shift fill the width. */
export const HEX_W = IMAGE_W / (COLS + 0.5);
/** Hex size (centre to corner). */
export const HEX_S = HEX_W / Math.sqrt(3);

export interface Hex {
  col: number;
  row: number;
  q: number;
  r: number;
}

export function hexAt(col: number, row: number): Hex {
  return { col, row, q: col - (row - (row & 1)) / 2, r: row };
}

export function hexCenter(col: number, row: number): [number, number] {
  return [HEX_W * (col + 0.5 + 0.5 * (row & 1)), HEX_S + 1.5 * HEX_S * row];
}

/** Hex (col,row) containing the pixel; null outside the grid. */
export function hexOfPixel(x: number, y: number): Hex | null {
  let best: Hex | null = null;
  let bestD = Infinity;
  const row0 = Math.round((y - HEX_S) / (1.5 * HEX_S));
  for (let row = row0 - 1; row <= row0 + 1; row++) {
    if (row < 0 || row >= ROWS) continue;
    const col0 = Math.round(x / HEX_W - 0.5 - 0.5 * (row & 1));
    for (let col = col0 - 1; col <= col0 + 1; col++) {
      if (col < 0 || col >= COLS) continue;
      const [cx, cy] = hexCenter(col, row);
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = hexAt(col, row);
      }
    }
  }
  return best;
}

/** Neighbour offsets for odd-r layout: [dcol, drow] for even and odd rows. */
const EVEN: [number, number][] = [
  [1, 0],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
const ODD: [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 1],
];

/** Neighbours in the order: E, NE, NW, W, SW, SE. Entries outside the grid are null. */
export function neighbours(col: number, row: number): ([number, number] | null)[] {
  const d = row & 1 ? ODD : EVEN;
  return d.map(([dc, dr]) => {
    const c = col + dc;
    const r = row + dr;
    return c < 0 || c >= COLS || r < 0 || r >= ROWS ? null : [c, r];
  });
}

/** Corner points of a hex, starting at the top corner, clockwise. */
export function hexCorners(col: number, row: number, scale = 1): [number, number][] {
  const [cx, cy] = hexCenter(col, row);
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    pts.push([cx + HEX_S * scale * Math.cos(a), cy + HEX_S * scale * Math.sin(a)]);
  }
  return pts;
}

/** Indexed read that fails loudly instead of returning undefined (strict index checks). */
export function at<T>(a: readonly T[], i: number): T {
  const v = a[i];
  if (v === undefined) throw new Error(`index ${i} out of range (length ${a.length})`);
  return v;
}

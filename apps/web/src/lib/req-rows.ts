import type { ReqResult } from '@shinobi/core';

/** How many rows a requirement list may have to be printed inline before it goes behind a button. */
export const INLINE_REQ_ROWS = 3;

/** The rows a requirement tree prints: its leaves, in tree order (a group with no rows prints none). */
export function reqRows(node: ReqResult): ReqResult[] {
  if (node.req.t === 'all' || node.req.t === 'any') return node.children.flatMap(reqRows);
  return [node];
}

/** The first row not met, depth first; null when every row holds. */
export function firstUnmetRow(node: ReqResult): ReqResult | null {
  return reqRows(node).find((r) => !r.met) ?? null;
}

/** The requirements a list is made of: the parts of a top-level "all of", else the tree itself; a part with no rows (an open stage) is left out. */
export function topRequirements(node: ReqResult): ReqResult[] {
  const parts = node.req.t === 'all' ? node.children : [node];
  return parts.filter((p) => reqRows(p).length > 0);
}

/** The first requirement not met, as one line of the compact view: a row, or the first row inside an "all of" part; an "any of" part stays whole (its alternatives are not hoisted out of it). */
export function firstUnmetPart(node: ReqResult): ReqResult | null {
  const part = topRequirements(node).find((p) => !p.met);
  if (!part) return null;
  if (part.req.t === 'all') return firstUnmetPart(part);
  return part;
}

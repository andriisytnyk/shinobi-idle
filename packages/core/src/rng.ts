/** State of one sfc32 stream: four unsigned 32-bit words, stored as a plain array. */
export type RngState = [number, number, number, number];

/** All named streams of a game: `action`, `combat`, `loot`, `world`. */
export type RngStreams = Record<string, RngState>;

export const STREAM_NAMES = ['action', 'combat', 'loot', 'world'] as const;

/** splitmix32: expands one seed into well-mixed words for stream seeding. */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

/** FNV-1a hash of a stream name, so streams get distinct seeds. */
function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Creates one stream from a game seed and the stream's name. */
export function createStream(seed: number, name: string): RngState {
  const next = splitmix32((seed ^ hashName(name)) >>> 0);
  const state: RngState = [next(), next(), next(), next()];
  // Warm up: discard a few outputs so near-identical seeds diverge.
  for (let i = 0; i < 12; i++) nextUint32(state);
  return state;
}

/** Creates every named stream from one game seed. */
export function createStreams(seed: number, names: readonly string[] = STREAM_NAMES): RngStreams {
  return Object.fromEntries(names.map((n) => [n, createStream(seed, n)]));
}

/** sfc32 step. Mutates `state` and returns the next unsigned 32-bit integer. */
export function nextUint32(state: RngState): number {
  const [a, b, c, d] = state;
  const t = (((a + b) >>> 0) + d) >>> 0;
  state[0] = (b ^ (b >>> 9)) >>> 0;
  state[1] = (c + (c << 3)) >>> 0;
  state[2] = ((((c << 21) | (c >>> 11)) >>> 0) + t) >>> 0;
  state[3] = (d + 1) >>> 0;
  return t;
}

/** Next float in [0, 1) from the named stream. Throws if the stream does not exist. */
export function nextFloat(streams: RngStreams, name: string): number {
  const state = streams[name];
  if (!state) throw new Error(`Unknown rng stream "${name}"`);
  return nextUint32(state) / 4294967296;
}

/** Next integer in [0, n) from the named stream. */
export function nextInt(streams: RngStreams, name: string, n: number): number {
  return Math.floor(nextFloat(streams, name) * n);
}

/** Next float in [0, 1) from a bare stream state, for engines that keep one stream of their own. */
export function nextFloatFrom(state: RngState): number {
  return nextUint32(state) / 4294967296;
}

/** Next unsigned 32-bit integer from the named stream, for seeding something else. */
export function nextSeed(streams: RngStreams, name: string): number {
  const state = streams[name];
  if (!state) throw new Error(`Unknown rng stream "${name}"`);
  return nextUint32(state);
}

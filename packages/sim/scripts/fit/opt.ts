import { writeFileSync } from 'node:fs';
import { DEFAULTS, apply, evaluate, orig, type Knobs } from './fit.ts';

const BOUNDS: Record<string, [number, number]> = {
  cs: [0.85, 1.4],
  wg: [0.15, 1.5],
  cds: [0.2, 2],
  w0: [0.15, 1.5],
  w1: [0.1, 1.5],
  bc: [0.3, 2],
  bd: [0.2, 1.5],
  bcost: [0, 3],
  bossHp: [0.5, 1.5], bossDmg: [0.5, 1.5], rhSlow: [0.5, 1.5], rhDur: [0.4, 3], evasive: [0.6, 2.5], hiddenAcc: [0.4, 1.5], bindDur: [0.5, 3], evaK: [0.25, 3], evaMin: [0.2, 3], evaMax: [0.8, 1.6], mtl: [0.5, 2],
  evaBase: [0.5, 2],
  evaTier: [0, 4],
  ps: [0.3, 2],
  accTier: [0.3, 2],
  etA: [0, 3],
  etE: [0, 5],
  eA0: [0.5, 1.8],
  eAL: [0, 8],
  eE0: [0.3, 3],
  eEL: [0.3, 2.5],
  rest: [0.3, 3],
  crD: [0.6, 1.5],
  crC: [0.6, 1.5],
  crB: [0.6, 1.5],
  cdProjectile: [0.3, 2.5],
  cdSeries: [0.3, 2.5],
  cdArea: [0.3, 2.5],
  cdControl: [0.3, 2.5],
  cdSignature: [0.3, 2.5],
};
const runs = Number(process.argv[2] ?? 40);
const rounds = Number(process.argv[3] ?? 6);
let best: Knobs = { ...DEFAULTS, ...(process.argv[4] ? JSON.parse(process.argv[4]) : {}) };
const score = (k: Knobs) => {
  // The tiers keep their order and sane waits: student >= 800 ms, genin >= 400, chunin >= 250.
  const w = [k.w0! * orig.wait[0]!, k.wg! * orig.wait[1]!, k.w1! * orig.wait[2]!];
  if (w[0]! < 800 || w[1]! < 400 || w[2]! < 250 || w[2]! > w[1]! || w[1]! > w[0]!) return Infinity;
  apply(k);
  return evaluate(runs).penalty;
};
let bestScore = score(best);
console.log('start', bestScore.toFixed(2));
for (let r = 0; r < rounds; r++) {
  for (const name of Object.keys(BOUNDS)) {
    for (const f of [0.6, 0.8, 0.92, 1.08, 1.25, 1.6]) {
      const [lo, hi] = BOUNDS[name]!;
      const v = Math.min(hi, Math.max(lo, (best[name] ?? 1) * f));
      if (v === best[name]) continue;
      const cand = { ...best, [name]: v };
      const s = score(cand);
      if (s < bestScore) {
        best = cand;
        bestScore = s;
      }
    }
  }
  console.log(
    'round',
    r,
    bestScore.toFixed(2),
    JSON.stringify(best, (_, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)),
  );
  writeFileSync(new URL('./opt-best.json', import.meta.url), JSON.stringify(best));
}

import { writeFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { curves } from '../hit-curves.ts';

const K: any = content.balance.K;
type P = Record<string, number>;
const BOUNDS: Record<string, [number, number]> = {
  E0: [0, 300], evaTier: [0, 150], E: [0, 100], accTier: [0, 300], eAcc0: [0, 300], eAccL: [0, 6],
  enemyAccTier: [0, 120], eEva0: [0, 150], eEvaL: [0, 6], enemyEvaTier: [0, 120],
};
function apply(p: P): void {
  K.evaBase = p.E0;
  K.rating.evaTier = p.evaTier;
  for (const v of Object.values(K.passiveFx) as any[]) v.evasion = p.E;
  K.rating.accTier = p.accTier;
  K.eAcc[0] = p.eAcc0;
  K.eAcc[1] = p.eAccL;
  K.rating.enemyAccTier = p.enemyAccTier;
  K.eEva[0] = p.eEva0;
  K.eEva[1] = p.eEvaL;
  K.rating.enemyEvaTier = p.enemyEvaTier;
}
const out = (x: number, lo: number, hi: number): number => Math.max(0, lo - x, x - hi);
function loss(p: P): number {
  apply(p);
  let l = 0;
  for (const c of curves()) {
    l += out(c.enemyHits.typical, 0.54, 0.66) * 3;
    l += out(c.playerHits, 0.78, 0.88) * 3;
    if (c.level >= 12) {
      l += Math.max(0, 0.08 - (c.enemyHits.neglect - c.enemyHits.typical));
      l += Math.max(0, 0.1 - (c.enemyHits.typical - c.enemyHits.max));
    }
    l += Math.max(0, c.enemyHits.neglect - 0.85);
    l += Math.max(0, 0.4 - c.allNatures.typical) * 2;
    l += Math.max(0, 0.12 - c.allNatures.max);
  }
  return l;
}
let best: P = {
  E0: K.evaBase, evaTier: K.rating.evaTier, E: 40, accTier: K.rating.accTier, eAcc0: K.eAcc[0], eAccL: K.eAcc[1],
  enemyAccTier: K.rating.enemyAccTier, eEva0: K.eEva[0], eEvaL: K.eEva[1], enemyEvaTier: K.rating.enemyEvaTier,
};
let bl = loss(best);
console.log('start', bl.toFixed(3));
for (let r = 0; r < 40; r++) {
  let moved = false;
  for (const n of Object.keys(BOUNDS)) {
    const [lo, hi] = BOUNDS[n]!;
    for (const d of [-0.3, -0.1, -0.03, 0.03, 0.1, 0.3]) {
      const v = Math.min(hi, Math.max(lo, best[n]! * (1 + d) + (best[n]! === 0 ? d * 5 : 0)));
      if (v === best[n]) continue;
      const c = { ...best, [n]: v };
      const s = loss(c);
      if (s < bl - 1e-9) { best = c; bl = s; moved = true; }
    }
  }
  if (!moved) break;
}
console.log('loss', bl.toFixed(3), JSON.stringify(best, (_, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
writeFileSync(new URL('./curves-best.json', import.meta.url), JSON.stringify(best));
apply(best);
console.table(curves().map((c) => ({ L: c.level, t: c.tier, et: c.enemyTier, n: c.enemyHits.neglect.toFixed(2), ty: c.enemyHits.typical.toFixed(2), mx: c.enemyHits.max.toFixed(2), pl: c.playerHits.toFixed(2) })));

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/* Throwaway fit harness: mutates the content's numbers in place and scores the three yardsticks against the baseline. */
import { readFileSync, writeFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { allEntries, fightRow } from '../../src/fightReport.ts';
import {
  createFight,
  defaultRules,
  encounterFor,
  fightAdvance,
  snapshotPlayer,
} from '@shinobi/core';
import { boss as bossCase, build } from '../../../core/test/analysis-helpers.ts';
import { curveLoss } from '../hit-curves.ts';
import { answersScore } from './answers.ts';
import { bossScore } from './boss.ts';
import { sustainedScore } from './sustained.ts';
import { entryOf } from '../../../core/src/combat/zones.ts';

const TIP: [number, number][] = [
  [38, 0.107],
  [40, 0.273],
  [42, 0.557],
  [44, 0.77],
  [46, 0.922],
  [48, 0.973],
  [50, 1],
];
const baseAt = (lvl: number): number => {
  if (lvl <= TIP[0]![0]) return TIP[0]![1];
  for (let i = 1; i < TIP.length; i++) {
    const [l1, r1] = TIP[i]!;
    const [l0, r0] = TIP[i - 1]!;
    if (lvl <= l1) return r0 + ((r1 - r0) * (lvl - l0)) / (l1 - l0);
  }
  return 1;
};
/** The win rate against the hunter by level, compared with the baseline curve shifted by up to two levels. */
export function tipping(runs: number): { err: number; line: string } {
  const entry = entryOf(content, 'core:boss_hunter')!;
  const levels = [36, 38, 40, 42, 44, 46, 48, 50];
  const rates = levels.map((lvl) => {
    const state = build(bossCase(lvl), 20);
    const snap = snapshotPlayer(state, content, defaultRules, undefined, ['core:boss_hunter']);
    let w = 0;
    for (let seed = 1; seed <= runs; seed++) {
      const f = createFight(snap, encounterFor(entry, content), seed, content, defaultRules);
      fightAdvance(f, f.cap + 1, content, defaultRules);
      if (f.result === 'victory') w++;
    }
    return w / runs;
  });
  let err = Infinity;
  for (let s = -2; s <= 2; s++) {
    let e = 0;
    levels.forEach((lvl, i) => (e += Math.abs(rates[i]! - baseAt(lvl + s))));
    err = Math.min(err, e);
  }
  err += Math.max(0, 0.95 - rates[rates.length - 1]!) * 4;
  return { err, line: levels.map((l, i) => l + ':' + rates[i]!.toFixed(2)).join(' ') };
}

const BASE = new URL('../../../../docs/balance-evidence/', import.meta.url);
const baseline: Record<string, any[]> = {};
for (const y of ['A', 'B', 'C', 'D'])
  baseline[y] = JSON.parse(readFileSync(new URL(`baseline-dev-3f559af-${y}.json`, BASE), 'utf8'));

const K: any = content.balance.K;
export const orig = {
  cast: new Map(content.techniques.map((t) => [t.id, t.cast])),
  cd: Object.fromEntries(Object.entries(K.role).map(([r, v]: any) => [r, v.cd])),
  wait: content.ai.tiers.map((t) => t.waitMs),
  basicCast: K.basicCast,
  basicCost: K.basicCost,
  basicDmg: [...K.basicDmg],
  evaBase: K.evaBase,
  evaTier: K.rating.evaTier,
  accTier: K.rating.accTier,
  passive: Object.fromEntries(Object.entries(K.passiveFx).map(([k, v]: any) => [k, v.evasion])),
  restS: K.rest.s,
  kn: K.rating.knowledge,
  etA: K.rating.enemyAccTier,
  etE: K.rating.enemyEvaTier,
  eAcc: [...K.eAcc],
  bossHp: K.boss.hp,
  bossDmg: K.boss.dmg,
  rhSlow: K.rhythm.slow,
  rhDur: K.rhythm.dur,
  evasive: K.trait.evasive,
  hiddenAcc: K.trait.hiddenAcc,
  bindDur: K.bind.dur,
  evaK: K.evaLevel.k,
  evaMin: K.evaLevel.min,
  evaMax: K.evaLevel.max,
  mtl: K.defence.masteryToLevel,
  eEva: [...K.eEva],
  rank: Object.fromEntries(content.techniques.map((t) => [t.id, t.rank])),
  role: Object.fromEntries(content.techniques.map((t) => [t.id, t.role])),
};
export type Knobs = Record<string, number>;
export const DEFAULTS: Knobs = {
  cs: 1,
  bossHp: 1,
  bossDmg: 1,
  rhSlow: 1,
  rhDur: 1,
  evasive: 1,
  hiddenAcc: 1,
  bindDur: 1,
  evaK: 1,
  evaMin: 1,
  evaMax: 1,
  mtl: 1,
  cds: 1,
  w0: 1,
  w1: 1,
  bc: 1,
  bd: 1,
  bcost: 1,
  evaBase: 1,
  evaTier: 1,
  accTier: 1,
  ps: 1,
  rest: 1,
  wg: 1,
  kn: 1,
  etA: 1,
  etE: 1,
  eA0: 1,
  eAL: 1,
  eE0: 1,
  eEL: 1,
  crD: 1,
  crC: 1,
  crB: 1,
  cdProjectile: 1,
  cdSeries: 1,
  cdArea: 1,
  cdControl: 1,
  cdSignature: 1,
};
export function apply(k: Knobs): void {
  const rankScale: Record<string, number> = {
    D: k.crD!,
    E: k.crD!,
    C: k.crC!,
    B: k.crB!,
    A: k.crB!,
    S: k.crB!,
  };
  for (const t of content.techniques as any[])
    t.cast = (orig.cast.get(t.id) ?? t.cast) * k.cs! * (rankScale[orig.rank[t.id] as string] ?? 1);
  const roleScale: Record<string, number> = {
    projectile: k.cdProjectile!,
    series: k.cdSeries!,
    area: k.cdArea!,
    control: k.cdControl!,
    signature: k.cdSignature!,
  };
  for (const [r, v] of Object.entries(K.role) as any)
    v.cd = orig.cd[r] * k.cds! * (roleScale[r] ?? 1);
  K.rating.knowledge = orig.kn * k.kn!;
  K.rating.enemyAccTier = orig.etA * k.etA!;
  K.rating.enemyEvaTier = orig.etE * k.etE!;
  (content.ai.tiers as any[]).forEach(
    (t, i) =>
      (t.waitMs = Math.max(
        50,
        Math.round(orig.wait[i]! * (i === 0 ? k.w0! : i === 1 ? k.wg! : k.w1!)),
      )),
  );
  K.basicCast = orig.basicCast * k.bc!;
  K.basicCost = orig.basicCost * k.bcost!;
  K.basicDmg[0] = orig.basicDmg[0] * k.bd!;
  K.basicDmg[1] = orig.basicDmg[1] * k.bd!;
  K.evaBase = orig.evaBase * k.evaBase!;
  K.rating.evaTier = orig.evaTier * k.evaTier!;
  K.rating.accTier = orig.accTier * k.accTier!;
  for (const [n, v] of Object.entries(K.passiveFx) as any) v.evasion = orig.passive[n]! * k.ps!;
  K.rest.s = orig.restS * k.rest!;
  K.boss.hp = orig.bossHp * k.bossHp!;
  K.boss.dmg = orig.bossDmg * k.bossDmg!;
  K.rhythm.slow = Math.min(0.95, orig.rhSlow * k.rhSlow!);
  K.rhythm.dur = orig.rhDur * k.rhDur!;
  K.trait.evasive = orig.evasive * k.evasive!;
  K.trait.hiddenAcc = orig.hiddenAcc * k.hiddenAcc!;
  K.bind.dur = orig.bindDur * k.bindDur!;
  K.evaLevel.k = orig.evaK * k.evaK!;
  K.evaLevel.min = orig.evaMin * k.evaMin!;
  K.evaLevel.max = orig.evaMax * k.evaMax!;
  K.defence.masteryToLevel = orig.mtl * k.mtl!;
  K.eAcc[0] = orig.eAcc[0] * k.eA0!;
  K.eAcc[1] = orig.eAcc[1] * k.eAL!;
  K.eEva[0] = orig.eEva[0] * k.eE0!;
  K.eEva[1] = orig.eEva[1] * k.eEL!;
}

const ARGS: [string, any][] = [
  ['A', {}],
  ['B', { natures: ['katon', 'futon', 'raiton', 'doton', 'suiton'] }],
  ['C', { rank: 'chunin', pouch: 'shop', food: 'model' }],
  ['D', { rank: 'genin' }],
];

export function evaluate(runs: number, entries?: string[]) {
  let penalty = 0;
  const lines: string[] = [];
  let outside = 0;
  const list = allEntries(content).filter((e) => !entries || entries.includes(e.id));
  for (const [y, opt] of ARGS) {
    for (const e of list) {
      const b = baseline[y]!.find((r) => r.enemy === e.id)!;
      const row = fightRow(e, { entries: [], runs, seed: 1, comparePouch: false, ...opt } as any);
      const s = row.stats;
      const dt = b.timeSec && s.timeSec ? s.timeSec.mean / b.timeSec.mean : null;
      const dw = (s.winRate - b.winRate) * 100;
      const basic = s.damageShare['basic'] ?? 0;
      let p = 0;
      const regular = 'region' in e;
      const full = row.loadout.length >= 4;
      const tb = y === 'C' ? 0.25 : 0.2;
      const wmin = y === 'C' ? 0.95 : 0.97;
      if (dt !== null) p += Math.max(0, Math.abs(dt - 1) - tb);
      else if (b.timeSec || s.timeSec) p += b.winRate > 0.1 || s.winRate > 0.1 ? 0.6 : 0;
      if (regular) p += Math.max(0, wmin - s.winRate) * 4;
      if (full) p += Math.max(0, basic - 0.4);
      penalty += p;
      const bad =
        (dt !== null && Math.abs(dt - 1) > tb) ||
        (regular && s.winRate < wmin) ||
        (full && basic > 0.4);
      if (bad) outside++;
      lines.push(
        `${y} ${e.id.padEnd(22)} win ${(b.winRate * 100).toFixed(0)}->${(s.winRate * 100).toFixed(0)} t ${b.timeSec?.mean.toFixed(1) ?? '-'}->${s.timeSec?.mean.toFixed(1) ?? '-'} x${dt?.toFixed(2) ?? '-'} basic ${(basic * 100).toFixed(0)}%${full ? '' : '(not full)'} ${bad ? '<<<' : ''}`,
      );
    }
  }
  const cl = curveLoss();
  penalty += cl * 3;
  lines.push('CURVES ' + cl.toFixed(3));
  const bs = bossScore(Math.max(30, runs));
  lines.push(...bs.lines);
  penalty += bs.penalty * 2;
  const an = answersScore();
  lines.push(...an.lines);
  penalty += an.penalty * 4;
  const su = sustainedScore();
  lines.push(...su.lines);
  penalty += su.penalty;
  const tip = tipping(Math.max(20, Math.floor(runs / 2)));
  lines.push('TIP ' + tip.line + ' err ' + tip.err.toFixed(2));
  penalty += tip.err * 8;
  return { penalty, outside, lines };
}

if (process.argv[1]?.endsWith('fit.ts')) {
  const arg = process.argv[2] ? (JSON.parse(process.argv[2]) as Knobs) : {};
  const knobs = { ...DEFAULTS, ...arg };
  apply(knobs);
  const t0 = Date.now();
  const r = evaluate(Number(process.argv[3] ?? 30));
  console.log(r.lines.join('\n'));
  console.log(
    'penalty',
    r.penalty.toFixed(2),
    'outside',
    r.outside,
    'of',
    r.lines.length,
    'ms',
    Date.now() - t0,
  );
  writeFileSync(new URL('./out-last.txt', import.meta.url), r.lines.join('\n'));
}

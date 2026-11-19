/* eslint-disable @typescript-eslint/no-unused-vars, no-regex-spaces */
import fs from 'node:fs';
const root = decodeURIComponent(new URL('../../../../', import.meta.url).pathname).replace(
  /^\/([A-Za-z]:)/,
  '$1',
);
const k = {
  cs: 1,
  cds: 1,
  w0: 1,
  wg: 1,
  w1: 1,
  bc: 1,
  bd: 1,
  bcost: 1,
  evaBase: 1,
  evaTier: 1,
  accTier: 1,
  ps: 1,
  rest: 1,
  kn: 1,
  etA: 1,
  etE: 1,
  crD: 1,
  crC: 1,
  crB: 1,
  cdProjectile: 1,
  cdSeries: 1,
  cdArea: 1,
  cdControl: 1,
  cdSignature: 1,
  eA0: 1,
  eAL: 1,
  eE0: 1,
  eEL: 1,
  ...JSON.parse(fs.readFileSync(root + 'packages/sim/scripts/fit/opt-best.json', 'utf8')),
};
const r2 = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const bp = root + 'docs/Shinobi Idle — MVP — зріз і баланс/balance.mjs';
let b = fs.readFileSync(bp, 'utf8');
const num = (re) => {
  const m = b.match(re);
  if (!m) throw new Error('re ' + re);
  return Number(m[1]);
};
const set = (re, f) => {
  const m = b.match(re);
  if (!m) throw new Error('re ' + re);
  b = b.replace(re, m[0].replace(m[1], String(f(Number(m[1])))));
};
const rankScale = { D: k.crD, E: k.crD, C: k.crC, B: k.crB, A: k.crB, S: k.crB };
for (const r of ['E', 'D', 'C', 'B', 'A', 'S'])
  set(new RegExp(`castByRank: \\{[^}]*?\\b${r}:([0-9.]+)`), (v) => r2(v * k.cs * rankScale[r], 3));
const roleKey = {
  Снаряд: k.cdProjectile,
  Серія: k.cdSeries,
  Площа: k.cdArea,
  Контроль: k.cdControl,
  Сигнатурна: k.cdSignature,
};
for (const [role, sc] of Object.entries(roleKey))
  set(new RegExp(`"${role}":\\{m:[0-9.]+,cd:([0-9.]+),c:`), (v) => r2(v * k.cds * sc, 2));
for (const role of ['Захист', 'Посилення'])
  set(new RegExp(`"${role}":\\{m:[0-9.]+,cd:([0-9.]+),c:`), (v) => r2(v * k.cds, 2));
const powScale = { E: (k.pwL ?? 1), D: (k.pwL ?? 1), C: 1, B: (k.pwH ?? 1), A: (k.pwH ?? 1), S: (k.pwH ?? 1) };
b = b.replace(/power: \{([^}]*)\}/, (whole, inner) =>
  whole.replace(
    inner,
    inner.replace(/([A-Z]):([0-9.]+)/g, (_, r, v) => `${r}:${r2(Number(v) * (k.pw ?? 1) * powScale[r], 2)}`),
  ),
);
for (const r of ['E', 'D'])
  set(new RegExp(`rankCd: \\{[^}]*?\\b${r}:([0-9.]+)`), (v) => r2(v * (k.rcD ?? 1), 2));
set(/levelScale: ([0-9.]+),/, (v) => r2(v * (k.ls ?? 1), 4));
set(/basicCast: ([0-9.]+),/, (v) => r2(v * k.bc, 3));
set(/basicCost: ([0-9.]+),/, (v) => r2(v * k.bcost, 2));
set(/basicDmg: \[([0-9.]+),/, (v) => r2(v * k.bd * (k.bd0 ?? 1), 2));
set(/basicDmg: \[[0-9.]+,([0-9.]+)\]/, (v) => r2(v * k.bd * (k.bd1 ?? 1), 3));
set(/evaBase: ([0-9.]+),/, (v) => r2(v * k.evaBase, 1));
set(/rating: \{ accTier:([0-9.]+),/, (v) => r2(v * k.accTier, 1));
set(/evaTier:([0-9.]+),/, (v) => r2(v * k.evaTier, 1));
set(/knowledge:([0-9.]+),/, (v) => r2(v * k.kn, 1));
set(/enemyAccTier:([0-9.]+),/, (v) => r2(v * k.etA, 1));
set(/enemyEvaTier:([0-9.]+) \}/, (v) => r2(v * k.etE, 1));
for (const n of ['shield', 'decoy', 'evasionBuff', 'passiveNegate'])
  set(new RegExp(`${n}:{ evasion:([0-9.]+)`), (v) => r2(v * k.ps, 1));
set(/eAcc: \[([0-9.]+),/, (v) => r2(v * k.eA0, 1));
set(/eAcc: \[[0-9.]+,([0-9.]+)\]/, (v) => r2(v * k.eAL, 2));
set(/eEva: \[([0-9.]+),/, (v) => r2(v * k.eE0, 1));
set(/eEva: \[[0-9.]+,([0-9.]+)\]/, (v) => r2(v * k.eEL, 2));
set(/rest: \{ s:([0-9.]+),/, (v) => r2(v * k.rest, 2));
set(/boss: { hp:([0-9.]+),/, (v) => r2(v * (k.bossHp ?? 1), 2));
set(/boss: { hp:[0-9.]+, dmg:([0-9.]+)/, (v) => r2(v * (k.bossDmg ?? 1), 2));
set(/rhythm: { slow:([0-9.]+),/, (v) => r2(Math.min(0.95, v * (k.rhSlow ?? 1)), 2));
set(/rhythm: { slow:[0-9.]+, dur:([0-9.]+)/, (v) => r2(v * (k.rhDur ?? 1), 2));
set(/evasive:([0-9.]+),/, (v) => r2(v * (k.evasive ?? 1), 2));
set(/hiddenAcc:([0-9.]+),/, (v) => r2(v * (k.hiddenAcc ?? 1), 2));
set(/evaLevel: { min:([0-9.]+)/, (v) => r2(v * (k.evaMin ?? 1), 3));
set(/evaLevel: { min:[0-9.]+, max:([0-9.]+)/, (v) => r2(v * (k.evaMax ?? 1), 3));
set(/bind: { dur:([0-9.]+)/, (v) => r2(v * (k.bindDur ?? 1), 2));
fs.writeFileSync(bp, b);
const pp = root + 'docs/Shinobi Idle — MVP — зріз і баланс/patch.mjs';
let p = fs.readFileSync(pp, 'utf8');
const slice = JSON.parse(
  fs.readFileSync(root + 'docs/Shinobi Idle — MVP — зріз і баланс/slice.json', 'utf8'),
);
const m = p.match(/  cast: \{([^\n]*)\},/);
const entries = [...m[1].matchAll(/"([^"]+)":([0-9.]+)/g)].map((x) => [x[1], Number(x[2])]);
p = p.replace(
  m[0],
  `  cast: { ${entries
    .map(([name, v]) => {
      const t = slice.techniques.find((x) => x.uk === name);
      const rk = t && t.rank !== '—' ? t.rank : 'D';
      return `"${name}":${r2(v * k.cs * rankScale[rk], 2)}`;
    })
    .join(', ')} },`,
);
fs.writeFileSync(pp, p);
const ap = root + 'packages/content/src/packs/core/data/hand/ai.json';
const ai = JSON.parse(fs.readFileSync(ap, 'utf8'));
const w = { student: k.w0, genin: k.wg, chunin: k.w1 };
for (const t of ai.tiers) t.waitMs = Math.round((t.waitMs * w[t.id]) / 10) * 10;
fs.writeFileSync(ap, JSON.stringify(ai, null, 2) + '\n');

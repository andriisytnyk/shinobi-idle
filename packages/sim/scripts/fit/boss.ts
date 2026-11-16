import { content, NATURE_IDS, type Boss, type NatureId } from '@shinobi/content';
import { beaten, beater, playerFor, simulate } from '../../../core/test/prep-helpers.ts';

const SECRET = ['core:boss_hunter', 'core:boss_twins', 'core:boss_mist', 'core:boss_nameless'];
export function bossScore(n: number): { penalty: number; lines: string[] } {
  let penalty = 0;
  const lines: string[] = [];
  const win = (boss: Boss, nature: NatureId, prep: 'prepared' | 'empty', knowledge: 'full' | 'none' = 'full', below = 0) =>
    simulate(boss, playerFor(boss, nature, { prep, below, tier: 1, knowledge }), n, 1).winRate;
  const by: Record<string, number> = {};
  const rows: { boss: Boss; full: number }[] = [];
  for (const boss of content.bosses) {
    let fav: NatureId, unfav: NatureId;
    if (boss.nature !== null && boss.nature !== 'wheel') {
      fav = beater(boss.nature);
      unfav = beaten(boss.nature);
    } else {
      const r = NATURE_IDS.map((nn) => ({ nn, w: win(boss, nn, 'prepared') })).sort((a, b) => b.w - a.w);
      fav = r[0]!.nn;
      unfav = r[r.length - 1]!.nn;
    }
    const full = win(boss, fav, 'prepared');
    const none = win(boss, fav, 'prepared', 'none');
    const unf = win(boss, unfav, 'prepared');
    const empty = win(boss, fav, 'empty');
    const below = win(boss, fav, 'prepared', 'full', 4);
    by[boss.id] = full;
    rows.push({ boss, full });
    let p = 0;
    p += Math.max(0, 0.55 - full) * 3 + Math.max(0, full - 0.9) * 3;
    p += Math.max(0, below - 0.6 * full) * 3;
    if (boss.cl >= 32) p += Math.max(0, 0.25 - (full - empty)) * 2;
    if (SECRET.includes(boss.id)) p += Math.max(0, 0.2 - (full - none)) * 2;
    const special = ['core:boss_wolf', 'core:boss_hunter', 'core:boss_mist'].includes(boss.id);
    if (boss.nature !== null && boss.nature !== 'wheel' && !special) p += Math.max(0, 0.2 - (full - unf)) * 2;
    penalty += p;
    lines.push(`${boss.id.replace('core:', '').padEnd(14)} cl${boss.cl} full ${full.toFixed(2)} none ${none.toFixed(2)} unfav ${unf.toFixed(2)} empty ${empty.toFixed(2)} below ${below.toFixed(2)} ${p > 0.001 ? '<<<' : ''}`);
  }
  const nameless = by['core:boss_nameless'] ?? 1;
  for (const r of rows) penalty += Math.max(0, nameless - r.full);
  penalty += Math.max(0, nameless - (by['core:boss_mist'] ?? 1));
  return { penalty, lines };
}

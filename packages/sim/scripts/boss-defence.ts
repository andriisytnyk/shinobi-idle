/**
 * The boss defence report: for each boss, how often its blows hit a Genin with Bingo knowledge 0 and 3
 * and a Chunin, each with no, half and full mastery of the defensive techniques they know, and the
 * win rate that follows. The hit share is the roll of the boss's accuracy against the evasion of
 * the player (the same roll its heavy blows and its plain attack make), read from a fight.
 * Run: `pnpm --filter @shinobi/sim exec tsx scripts/boss-defence.ts > docs/balance-evidence/boss-defence.md`.
 */
import { content } from '@shinobi/content';
import { defaultRules, createFight, hitChanceOf, makeCtx, xpAt } from '@shinobi/core';
import { buildCharacter, equipFor, rankForLevel } from '../src/character.ts';
import { defaultNature } from '../src/constants.ts';
import { allEntries } from '../src/fightReport.ts';
import { encounterOf, fightSnapshot, runFights } from '../src/fights.ts';

const K = content.balance.K;
const passive = content.techniques.filter((t) => t.combat?.passive !== undefined);
const CONFIGS = [
  { name: 'Genin, knowledge 0', chunin: false, know: 0 },
  { name: 'Genin, knowledge 3', chunin: false, know: 3 },
  { name: 'Chunin, knowledge 3', chunin: true, know: 3 },
];
const MASTERY = [
  { name: 'none', level: 1 },
  { name: 'half', level: Math.round(K.masteryCap / 2) },
  { name: 'full', level: K.masteryCap },
];
const pct = (x: number): string => `${Math.round(x * 100)}%`;

const out: string[] = [
  '# Захист від босів: частка влучань і шанс перемоги',
  '',
  `Мірило: рівень боса, одна природа, підсумок і страви; захисні техніки, відкриті на цьому рівні, мають Майстерність «жодної» (1), «половину» (${Math.round(K.masteryCap / 2)}) чи «повну» (${K.masteryCap}). Частка влучань — шанс удару боса (його точність проти ухилення гравця). Перемоги — 100 боїв, сід 1.`,
  '',
  '| Бос | Гравець | Захисних технік | Ухилення (жодної / половина / повна) | Влучань (жодної / половина / повна) | Перемог (жодної / половина / повна) |',
  '| --- | --- | --- | --- | --- | --- |',
];
for (const boss of allEntries(content).filter((e) => !('region' in e))) {
  for (const cfg of CONFIGS) {
    const cells = MASTERY.map((m) => {
      const level = Math.min(K.cap, boss.cl);
      const rank = cfg.chunin
        ? (content.playerRanks[2]?.id ?? 'chunin')
        : rankForLevel(Math.min(level, K.cap), content);
      const genin = cfg.chunin ? rank : (content.playerRanks[1]?.id ?? 'genin');
      const state = buildCharacter(content, {
        seed: 1,
        level,
        rank: cfg.chunin ? rank : genin,
        natures: [defaultNature(content)],
      });
      equipFor(state, boss.id, content, defaultRules, { pouch: 'shop', food: 'model' }, level);
      let known = 0;
      for (const t of passive) {
        if (!state.known[t.id]) continue;
        known++;
        state.mastery[t.id] = { xp: xpAt(m.level) };
      }
      // Knowledge of the boss: the level the book gives, from none (not even seen) to the studied one.
      delete state.bingo[boss.id];
      if (cfg.know > 0) {
        state.bingo[boss.id] = {
          seen: 1,
          wins: 0,
          losses: 0,
          timeouts: 0,
          bought: cfg.know,
          bounty: 0,
        };
      }
      const snap = fightSnapshot(state, boss.id, content, defaultRules);
      const enc = encounterOf(state, boss, content);
      const fight = createFight(snap, enc, 1, content, defaultRules);
      const body = fight.enemies[0];
      const hit = body ? hitChanceOf(makeCtx(fight, content, defaultRules), body, fight.player) : 0;
      const stats = runFights(snap, enc, 100, 1, content, defaultRules);
      return {
        known,
        evasion: fight.player.evasion + K.rating.knowledge * cfg.know,
        hit,
        win: stats.winRate,
      };
    });
    out.push(
      `| ${boss.id} | ${cfg.name} | ${cells[0]?.known ?? 0} | ${cells.map((c) => Math.round(c.evasion)).join(' / ')} | ${cells.map((c) => pct(c.hit)).join(' / ')} | ${cells.map((c) => pct(c.win)).join(' / ')} |`,
    );
  }
}
console.log(out.join('\n'));

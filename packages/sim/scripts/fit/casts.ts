/** Casts of techniques per won fight and mean time, yardstick A and D, first enemies: `tsx scripts/fit/casts.ts`. */
import { content } from '@shinobi/content';
import {
  createFight,
  createStream,
  fightAdvance,
  fightTimeMs,
  nextUint32,
  defaultRules,
} from '@shinobi/core';
import { buildCharacter, equipFor, rankForLevel } from '../../src/character.ts';
import { defaultNature } from '../../src/constants.ts';
import { encounterOf, fightSnapshot } from '../../src/fights.ts';

const rules = defaultRules;
if (process.env.RCD) content.balance.K.rankCd.D = Number(process.env.RCD);
const RUNS = 100;
for (const [yard, opts] of [
  ['A', {}],
  ['D', { rank: 'genin' as const }],
] as const) {
  for (const id of ['dummy', 'bandit', 'arsonist', 'wolf', 'centipede']) {
    const entry = content.enemies.find((e) => e.id === `core:${id}`)!;
    const level = entry.cl;
    const rank = ('rank' in opts ? opts.rank : undefined) ?? rankForLevel(level, content);
    const state = buildCharacter(content, {
      seed: 1,
      level,
      rank,
      natures: [defaultNature(content)],
    });
    equipFor(state, entry.id, content, rules, { pouch: 'none', food: 'none' }, level);
    const snap = fightSnapshot(state, entry.id, content, rules);
    let casts = 0;
    let time = 0;
    let n = 0;
    for (let i = 0; i < RUNS; i++) {
      const fight = createFight(
        snap,
        encounterOf(state, entry, content),
        nextUint32(createStream(1, `sim.${i}`)),
        content,
        rules,
      );
      fightAdvance(fight, fight.cap + 1, content, rules);
      if (fight.result !== 'victory' && fight.result !== 'fled') continue;
      n++;
      time += fightTimeMs(fight) / 1000;
      casts += (fight.log ?? []).filter(
        (l) => l.side === 'player' && l.act === 'cast' && l.tech && !l.via && l.ally === undefined,
      ).length;
    }
    console.log(
      `${yard} ${id.padEnd(10)} time ${(time / n).toFixed(1)} s  casts ${(casts / n).toFixed(2)}  loadout ${state.loadouts.active.length}`,
    );
  }
}

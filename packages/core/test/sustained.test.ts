/**
 * Sustained zone fighting: two game hours without a break, each regular enemy at the level of the player, genin
 * tactics, the automatic loadout. Health does not come back between fights: it regenerates slowly and food restores it.
 * The player restarts the zone after a defeat, as a player coming back would. Defeats and Wounds are printed.
 *
 *  - With a pouch of this level's food and a reasonable stock in the Bank (the pouch is refilled from it between
 *    fights), two hours go with at most a few defeats.
 *  - With no food at all the series wears the character down: the first defeat comes within a band of minutes.
 */
import { content, type NatureId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  currentHp,
  performerMaxHp,
  createState,
  dispatch,
  refreshUnlocks,
  teamFor,
  updateQuests,
} from '../src/index.ts';
import { levelsFor } from './fight-helpers.ts';
import { setLevel } from './helpers.ts';
import { healItemFor } from './prep-helpers.ts';
import { openWorld } from './prep-state.ts';

const HOURS = 2;
const STEP = 10_000;
/** The share of the maximum health at which a player who has fallen goes back to the zone. */
const REST_AT = 0.8;
/** Units of the level's food a player has in the Bank for the session: a few stacks of the pouch. */
const BANK_STOCK = 240;
// The thief is a mission enemy: no zone, fought only through its mission, so not here.
const regular = content.enemies.filter(
  (e) => e.id !== 'core:dummy' && content.zones.some((z) => z.enemy === e.id),
);

interface Run {
  defeats: number;
  wounds: number;
  kills: number;
  /** Minutes to the first defeat, or null when there was none. */
  firstDefeat: number | null;
  /** Units of food used. */
  eaten: number;
}

function grind(enemyId: string, nature: NatureId, food: boolean): Run {
  const enemy = content.enemies.find((e) => e.id === enemyId);
  const zone = content.zones.find((z) => z.enemy === enemyId);
  if (!enemy) throw new Error(enemyId);
  const state = createState(77, content);
  state.player.rank = 'genin';
  openWorld(state);
  state.player.natures = [nature];
  state.team = teamFor(content, nature);
  const levels = levelsFor(enemy.cl, nature);
  for (const skill of Object.keys(levels) as (keyof typeof levels)[])
    setLevel(state, skill, levels[skill]!);
  refreshUnlocks(state, content, true);
  updateQuests(state, content);
  state.events = [];
  const item = healItemFor(enemy.cl);
  if (food) {
    // The medic pouch (the graduation gift) eats the slot's food on its own when health is low.
    state.bank['core:medpouch'] = 1;
    state.bank[item] = BANK_STOCK;
    dispatch(state, { type: 'pouch.set', slot: 0, item }, content);
    dispatch(state, { type: 'pouch.medic', slot: 0 }, content);
  }
  let defeats = 0;
  let wounds = 0;
  let firstDefeat: number | null = null;
  const start = () =>
    dispatch(
      state,
      { type: 'action.start', slot: 0, kind: 'fight', id: zone?.id ?? enemyId },
      content,
    );
  start();
  let resting = 0;
  const total = HOURS * 3_600_000;
  for (let t = 0; t < total; t += STEP) {
    const before = state.wounds.stacks;
    advance(state, STEP, content);
    if (!state.slots[0]?.action && resting === 0) {
      defeats++;
      firstDefeat ??= (t + STEP) / 60_000;
      resting = 1;
    }
    // A player who has fallen waits until health is back before going on (REST_AT of the maximum), then starts the zone again.
    if (
      resting === 1 &&
      currentHp(state, 0, content).hp >= REST_AT * performerMaxHp(state, content)
    ) {
      resting = 0;
      start();
    }
    wounds = Math.max(wounds, state.wounds.stacks, before);
  }
  const eaten = BANK_STOCK - (state.bank[item] ?? 0) - (state.pouch.slots[0]?.n ?? 0);
  return {
    defeats,
    wounds,
    kills: state.counters[`kills.${enemyId}`] ?? 0,
    firstDefeat,
    eaten: food ? eaten : 0,
  };
}

describe('two hours of continuous zone fighting', () => {
  const natures: NatureId[] = ['katon', 'doton'];
  const rows = regular.map((enemy) => ({
    enemy,
    fed: natures.map((n) => ({ n, r: grind(enemy.id, n, true) })),
    bare: natures.map((n) => ({ n, r: grind(enemy.id, n, false) })),
  }));

  it('prints defeats, peak Wounds, kills, food used and the first defeat per enemy', () => {
    const cell = (r: Run) =>
      `${r.defeats} / ${r.wounds} / ${r.kills} / ${r.eaten} / ${r.firstDefeat === null ? '-' : r.firstDefeat.toFixed(0)}`;
    const lines = rows.map(
      ({ enemy, fed, bare }) =>
        `| ${enemy.id.replace('core:', '')} | ${enemy.cl} | ${enemy.traits.join(', ') || '-'} | ${fed.map(({ r }) => cell(r)).join(' | ')} | ${bare.map(({ r }) => cell(r)).join(' | ')} |`,
    );
    console.log(
      `Sustained (${HOURS} h, genin, auto loadout): defeats / peak wounds / kills / food / first defeat, min\n| enemy | level | traits | fed Katon | fed Doton | no food Katon | no food Doton |\n| --- | --- | --- | --- | --- | --- | --- |\n${lines.join('\n')}`,
    );
    expect(lines).toHaveLength(22);
  });

  // With the food of its level and a stock in the Bank, an enemy at the player's level is fought for hours.
  for (const { enemy, fed } of rows) {
    for (const { n, r } of fed) {
      it(`${enemy.id.replace('core:', '')} (${n}) with food: at most ${MOST_DEFEATS} defeats in ${HOURS} h`, () => {
        expect(r.defeats).toBeLessThanOrEqual(MOST_DEFEATS);
      });
    }
  }

  // Without food the series wears the character down and ends in a defeat, within the band, for any enemy that hurts.
  for (const { enemy, bare } of rows) {
    for (const { n, r } of bare) {
      it(`${enemy.id.replace('core:', '')} (${n}) without food: the first defeat comes within ${BAND[0]}-${BAND[1]} min`, () => {
        if (r.firstDefeat === null) return expect(NO_DEFEAT).toContain(enemy.id);
        expect(r.firstDefeat).toBeGreaterThanOrEqual(BAND[0]);
        expect(r.firstDefeat).toBeLessThanOrEqual(BAND[1]);
      });
    }
  }
});

/** Defeats allowed in two hours with food. */
const MOST_DEFEATS = 2;
/** The band of minutes in which a series without food ends in a defeat. */
const BAND: [number, number] = [1, 40];
/** Enemies that a player of their level never loses to, even with no food (they barely hurt). */
const NO_DEFEAT: string[] = [];

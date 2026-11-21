import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { createFight, handStatus } from '../src/index.ts';
import { enemyAt, rules, scripted, sec, tech } from './fight-helpers.ts';

const FIREBALL = 'core:great_fireball';
const LEVEL = 34;

describe('handStatus: the hand with the reasons each technique waits', () => {
  const make = () => createFight(scripted([FIREBALL]), enemyAt(LEVEL), 1, content, rules);

  it('lists the hand in order and reads ready for a fresh technique', () => {
    const fight = make();
    const hand = handStatus(fight, fight.player);
    expect(hand.map((h) => h.id)).toEqual(fight.kit.techniques.map((t) => t.id));
    const h = hand.find((x) => x.id === FIREBALL);
    expect(h).toMatchObject({
      cooldownLeft: 0,
      affordable: true,
      stanceOk: true,
      castable: true,
      pool: tech(fight, FIREBALL).pool,
      cost: tech(fight, FIREBALL).cost,
    });
  });

  it('reads the cooldown left, the pool it cannot pay and the missing stance, and changes nothing', () => {
    const fight = make();
    const kit = tech(fight, FIREBALL);
    fight.player.cd[FIREBALL] = fight.t + sec(2.4);
    fight.player.chakra = 0;
    fight.player.stamina = 0;
    kit.requiresStance = true;
    const before = JSON.stringify(fight);
    const h = handStatus(fight, fight.player).find((x) => x.id === FIREBALL);
    expect(h).toMatchObject({ cooldownLeft: sec(2.4), affordable: false, stanceOk: false });
    expect(JSON.stringify(fight)).toBe(before);
  });
});

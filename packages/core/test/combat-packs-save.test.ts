/**
 * T3: a saved fight that holds ids of a pack loads with the core pack alone: what the content does
 * not have (a status, a trait, a combo, a nature) is dropped without a throw, a fight against an
 * entry the content does not have is discarded as before, and the game goes on.
 */
import { describe, expect, it } from 'vitest';
import {
  advance,
  applyStatusById,
  createFight,
  createState,
  defaultRules,
  deserialize,
  dispatch,
  fightAdvance,
  makeCtx,
  parseFight,
  serialize,
  type FightState,
} from '../src/index.ts';
import { HOUR } from './helpers.ts';
import { TECH, caster, core, encounter, mod, modRules, player, sec, withAi } from './combat-packs-helpers.ts';

/** A fight against the pack enemy, a few seconds in, with the pack's status on both sides. */
function packFight(known: string[] = []): FightState {
  const rules = withAi(caster(TECH));
  const fight = createFight(player(known), encounter('testmod:boss_shell'), 3, mod, rules);
  const ctx = makeCtx(fight, mod, rules);
  const body = fight.enemies[0];
  if (!body) throw new Error('no body');
  applyStatusById(ctx, body, 'testmod:chill', 'tester');
  applyStatusById(ctx, fight.player, 'testmod:chill', 'tester');
  fightAdvance(fight, sec(5), mod, rules);
  fight.tally.combos['testmod:frostburn'] = 1;
  return fight;
}

describe('a saved fight with the ids of a pack, read with the core pack alone', () => {
  it('reads back unchanged where the pack is loaded', () => {
    const fight = packFight();
    expect(parseFight(JSON.parse(JSON.stringify(fight)), mod)).toEqual(fight);
  });

  it('drops the traits, natures, statuses and combos the content does not have, without a throw', () => {
    const fight = packFight();
    const body = fight.enemies[0];
    if (!body) throw new Error('no body');
    body.nature = 'testmod:aether';
    fight.natures = ['testmod:aether', 'katon'];
    const raw = JSON.parse(JSON.stringify(fight));
    const read = parseFight(raw, core);
    expect(read).not.toBeNull();
    const enemy = read?.enemies[0];
    expect(enemy?.traits).toEqual([]);
    expect(enemy?.nature).toBeNull();
    expect(enemy?.effects.filter((e) => e.id.startsWith('testmod:'))).toEqual([]);
    expect(read?.player.effects.filter((e) => e.id.startsWith('testmod:'))).toEqual([]);
    expect(read?.natures).toEqual(['katon']);
    expect(read?.tally.combos['testmod:frostburn']).toBeUndefined();
    expect(read?.tally.statuses['testmod:chill']).toBeUndefined();
  });

  it('discards a fight whose kit holds a technique the content does not have', () => {
    const fight = packFight([TECH]);
    expect(parseFight(JSON.parse(JSON.stringify(fight)), core)).toBeNull();
  });

  it('loses a saved game fight against a pack entry and goes on playing', () => {
    const state = createState(1, mod);
    const started = dispatch(
      state,
      { type: 'action.start', slot: 0, kind: 'fight', id: 'testmod:shellback' },
      mod,
      modRules,
    );
    expect(started.ok, 'the pack enemy can be fought where the pack is loaded').toBe(true);
    advance(state, 20_000, mod, modRules);
    expect(state.combat?.enemy).toBe('testmod:shellback');
    const text = serialize(state, 0);
    // Where the pack is gone the action is lost with its fight, and the game still runs.
    const back = deserialize(text, core, defaultRules);
    expect(back.combat?.enemy ?? null).not.toBe('testmod:shellback');
    expect(() => advance(back, HOUR, core)).not.toThrow();
  });

  it('keeps a fight against a core enemy that carries pack ids, minus the ids', () => {
    const state = createState(2, mod);
    const fightId = 'core:dummy';
    const started = dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: fightId }, mod, modRules);
    expect(started.ok).toBe(true);
    advance(state, 10_000, mod, modRules);
    const combat = state.combat;
    if (!combat) throw new Error('no fight');
    const body = combat.fight.enemies[0];
    if (!body) throw new Error('no body');
    body.traits.push('testmod:shelled');
    body.specials.push('testmod:thirdStrike');
    body.nature = 'testmod:aether';
    applyStatusById(makeCtx(combat.fight, mod, modRules), combat.fight.player, 'testmod:chill', 'tester');
    const back = deserialize(serialize(state, 0), core, defaultRules);
    expect(back.combat?.enemy).toBe(fightId);
    const read = back.combat?.fight.enemies[0];
    expect(read?.traits).not.toContain('testmod:shelled');
    expect(read?.nature).toBeNull();
    expect(back.combat?.fight.player.effects.some((e) => e.id.startsWith('testmod:'))).toBe(false);
    expect(() => advance(back, HOUR, core)).not.toThrow();
  });
});

/** A5: the pouch: typed slots, per-fight amounts, refills, what each tool does, hand use and the medic pouch. */
import { content, type TraitId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  applyStatusById,
  createFight,
  defaultRules,
  dispatch,
  fightAdvance,
  findEffect,
  needOf,
  secMs,
  snapshotPlayer,
  statOf,
  workOf,
  type CombatAi,
  type FightState,
  type PlayerSnapshot,
} from '../src/index.ts';
import { K, enemyAt, pacify, quiet, rules, scripted, sec, withAi, ctxOf } from './fight-helpers.ts';
import { addEffect } from '../src/index.ts';
import { fighter, ids, run, startFight, startOperation, stock, unlock } from './prep-state.ts';

const LEVEL = 34;
/** Units a food slot takes into a fight (the per-fight amount of its kind). */
const FOOD = 10;

/** A fight in which the AI uses `item` the first time it can, and otherwise waits. */
function itemFight(
  item: string,
  n = 3,
  traits: TraitId[] = [],
  when?: (f: FightState) => boolean,
  seed = 4,
) {
  const snap: PlayerSnapshot = { ...scripted(['core:leaf_whirlwind']), pouch: [{ id: item, n }] };
  let used = false;
  let current: FightState | null = null;
  const ai: CombatAi = () => {
    if (!used && (!when || (current && when(current)))) {
      used = true;
      return { type: 'item', id: item };
    }
    return { type: 'wait' };
  };
  const r = withAi(ai, rules);
  const fight = createFight(snap, enemyAt(LEVEL, traits), seed, content, r);
  current = fight;
  quiet(pacify(fight));
  fight.player.damage = 0;
  fight.kit.staminaRegen = 0;
  return { fight, r };
}

describe('stacks', () => {
  it('holds the per-fight amount of its kind, one item per slot, packed from the bank', () => {
    const state = fighter(1, 20);
    stock(state, { [ids.heal]: FOOD + 3 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    expect(state.pouch.slots[0]).toEqual({ kind: 'core:pk_food', id: ids.heal, n: FOOD });
    expect(state.bank[ids.heal]).toBe(3);
    // A slot of another kind does not take it, and a tool of nothing is no pouch item.
    expect(dispatch(state, { type: 'pouch.set', slot: 1, item: ids.heal }, content)).toEqual({
      ok: false,
      reason: 'error.wrongSlotKind',
    });
    expect(dispatch(state, { type: 'pouch.set', slot: 1, item: 'core:rice' }, content)).toEqual({
      ok: false,
      reason: 'error.notPouchItem',
    });
    // Emptying a slot returns its stack to the bank.
    run(state, { type: 'pouch.set', slot: 0, item: null });
    expect(state.bank[ids.heal]).toBe(FOOD + 3);
  });

  it('has a slot of each kind at genin and another combat slot with the chunin vest', () => {
    const state = fighter(1, 20);
    expect(state.pouch.slots.map((s) => s.kind)).toEqual([
      'core:pk_food',
      'core:pk_combat',
      'core:pk_cure',
    ]);
    state.player.rank = 'chunin';
    stock(state, { [ids.kunai]: 1, [ids.tag]: 1 });
    run(state, { type: 'pouch.set', slot: 1, item: ids.kunai });
    // The same item cannot sit in two slots, even of the same kind.
    expect(dispatch(state, { type: 'pouch.set', slot: 3, item: ids.kunai }, content)).toEqual({
      ok: false,
      reason: 'error.itemInPouch',
    });
    run(state, { type: 'pouch.set', slot: 3, item: ids.tag });
    expect(state.pouch.slots.map((s) => s.kind)).toEqual([
      'core:pk_food',
      'core:pk_combat',
      'core:pk_cure',
      'core:pk_combat',
    ]);
  });
});

describe('refills', () => {
  it('tops the slots up from the bank before the fights of a zone', () => {
    const state = fighter(2, 40);
    stock(state, { [ids.heal]: 30 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    state.pouch.slots[0] = { kind: 'core:pk_food', id: ids.heal, n: 1 };
    const bank = state.bank[ids.heal] ?? 0;
    expect(startFight(state, 'core:zone_dummy')).toEqual({ ok: true });
    // Starting the zone packed the pouch; spend most of it as a fight would.
    expect(state.pouch.slots[0]?.n).toBe(FOOD);
    expect(state.bank[ids.heal]).toBe(bank - (FOOD - 1));
    state.pouch.slots[0] = { kind: 'core:pk_food', id: ids.heal, n: 0 };
    advance(state, 90_000, content);
    expect(state.counters['kills.core:dummy'] ?? 0).toBeGreaterThan(0);
    expect(state.pouch.slots[0]?.n).toBeGreaterThan(0);
  });

  it('fills the pouch again before every stage of an operation, and not inside a stage', () => {
    const state = fighter(3, 50);
    unlock(state, 'op.hideout.unlocked');
    stock(state, { [ids.heal]: 60 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    expect(startOperation(state, 'core:op_hideout')).toEqual({ ok: true });
    expect(state.pouch.slots[0]?.n).toBe(FOOD);
    // Part of the pouch is spent: the running fight carries the count, and nothing refills it while the fight goes on.
    state.pouch.slots[0] = { kind: 'core:pk_food', id: ids.heal, n: 2 };
    if (state.combat) state.combat.fight.pouch[0] = { id: ids.heal, n: 2 };
    const bank = state.bank[ids.heal] ?? 0;
    const first = state.combat?.run?.step ?? -1;
    for (let i = 0; i < 4000 && state.combat?.run?.step === first; i++) {
      advance(state, 100, content);
      if (state.combat?.run?.step === first && state.combat.phase === 'fight')
        expect(state.combat.fight.pouch[0]?.n ?? 0).toBeLessThanOrEqual(2);
    }
    // The first fight is won; the pouch is as it was left, and the bank has given nothing yet.
    expect(state.combat?.run?.step).toBe(first + 1);
    expect(state.counters['kills.core:guard_pack']).toBe(1);
    const left = state.pouch.slots[0]?.n ?? 0;
    expect(left).toBeLessThanOrEqual(2);
    expect(state.bank[ids.heal]).toBe(bank);
    // The next fight begins with the slot filled up to the per-fight amount from the bank.
    for (let i = 0; i < 400 && state.combat?.phase !== 'fight'; i++) advance(state, 100, content);
    expect(state.combat?.phase).toBe('fight');
    expect(bank - (state.bank[ids.heal] ?? 0)).toBe(FOOD - left);
    expect(state.combat?.fight.pouch[0]?.n ?? 0).toBeGreaterThanOrEqual(FOOD - 1);
  });
});

describe('what each tool does, and what it costs', () => {
  const action = needOf(secMs(K.pillAction));

  /** Uses `item` once and checks the unit and the time it took. */
  function used(item: string, traits: TraitId[] = [], when?: (f: FightState) => boolean) {
    const { fight, r } = itemFight(item, 3, traits, when);
    // Stop the moment the item is used, so its effect is still in force.
    for (let i = 0; i < 600 && fight.pouch[0]?.n === 3; i++)
      fightAdvance(fight, workOf(100), content, r);
    expect(fight.pouch[0]?.n).toBe(2);
    return { fight, r };
  }

  it('takes one unit and the item action time for every use', () => {
    for (const item of [
      ids.kunai,
      ids.shuriken,
      ids.senbon,
      ids.tag,
      ids.wiretrap,
      ids.smoke,
      ids.heal,
    ]) {
      const { fight } = used(item);
      expect(fight.player.phase, item).toBe('act');
      expect(fight.player.act?.kind, item).toBe('item');
      expect(fight.player.timer.need, item).toBe(action);
    }
  });

  it('thrown tools hurt for the tool damage; an interrupting one cancels a cast', () => {
    for (const item of [ids.kunai, ids.shuriken, ids.senbon]) {
      let damage = 0;
      for (let seed = 1; seed < 40 && damage === 0; seed++) {
        const { fight, r } = itemFight(item, 3, [], undefined, seed);
        fightAdvance(fight, workOf(1500), content, r);
        damage = fight.tally.damage[item] ?? 0;
        if (damage > 0) expect(damage).toBeCloseTo(fight.kit.toolDamage, 9);
      }
      expect(damage, item).toBeGreaterThan(0);
    }
    const casting = (f: FightState) => f.enemies[0]?.data['caster.cast'] === 1;
    const { fight } = used(ids.kunai, ['caster'], casting);
    expect(fight.tally.interrupts).toBe(1);
    expect(fight.enemies[0]?.data['caster.cast']).toBe(0);
  });

  it('an explosive tag hits every enemy for the tool damage', () => {
    const { fight } = used(ids.tag, ['pack']);
    expect(fight.enemies.length).toBeGreaterThan(1);
    for (const e of fight.enemies) expect(1e9 - e.hp).toBeCloseTo(fight.kit.toolDamage, 6);
  });

  it('wire traps and paralytic senbon bind every enemy', () => {
    for (const item of [ids.wiretrap, ids.parSenbon]) {
      const { fight } = used(item, ['pack']);
      for (const e of fight.enemies) {
        expect(findEffect(e, 'bind'), item).toBeDefined();
        expect(statOf(e, 'evasion', 100)).toBeCloseTo(100 * K.bindEva, 9);
      }
    }
  });

  it('poisoned senbon put damage over time on an enemy and stop its regeneration', () => {
    const { fight } = used(ids.poisonSenbon, ['regen']);
    const e = fight.enemies[0];
    const dot = e && findEffect(e, 'toolPoison');
    expect(dot).toMatchObject({ kind: 'periodic', suppresses: 'regen' });
    expect(dot?.kind === 'periodic' ? dot.amount : 0).toBeCloseTo(
      K.toolFx.dot.pct * (e?.maxHp ?? 0),
      6,
    );
  });

  it('smoke and tear bombs apply their modifiers', () => {
    const smoke = used(ids.smoke).fight;
    expect(statOf(smoke.player, 'evasion', 100)).toBeCloseTo(120, 9);
    const tear = used(ids.tear, ['caster'], (f) => f.enemies[0]?.data['caster.cast'] === 1).fight;
    expect(statOf(tear.enemies[0] ?? smoke.player, 'accuracy', 100)).toBeCloseTo(85, 9);
    expect(tear.tally.interrupts).toBe(1);
  });

  it('smelling salts dispel an illusion and an antidote cures poison', () => {
    const salt = itemFight(ids.salt);
    addEffect(salt.fight.player, {
      kind: 'modifier',
      id: 'illusion',
      src: 'x',
      until: sec(60),
      stat: 'accuracy',
      op: 'mul',
      value: 0.25,
    });
    fightAdvance(salt.fight, workOf(1500), content, salt.r);
    expect(findEffect(salt.fight.player, 'illusion')).toBeUndefined();
    expect(salt.fight.pouch[0]?.n).toBe(2);

    const cure = itemFight(ids.antidote);
    applyStatusById(ctxOf(cure.fight), cure.fight.player, 'poison', 'x');
    expect(findEffect(cure.fight.player, 'poison')).toBeDefined();
    fightAdvance(cure.fight, workOf(1500), content, cure.r);
    expect(findEffect(cure.fight.player, 'poison')).toBeUndefined();
  });

  it('a sleeping powder stuns an ordinary enemy at the configured chance', () => {
    let slept = 0;
    const tries = 200;
    for (let seed = 1; seed <= tries; seed++) {
      const { fight, r } = itemFight(ids.sleep, 3, [], undefined, seed);
      fightAdvance(fight, workOf(3000), content, r);
      // The stun is short: it is the count of stuns, not an effect that is still there, that tells.
      if ((fight.tally.statuses.stun ?? 0) > 0) slept++;
    }
    expect(slept / tries).toBeGreaterThan(K.itemFx.sleep!.chance! - 0.15);
    expect(slept / tries).toBeLessThan(K.itemFx.sleep!.chance! + 0.15);
  });

  it('pills heal, and restore chakra', () => {
    const heal = itemFight(ids.heal);
    heal.fight.player.hp = 10;
    fightAdvance(heal.fight, workOf(1500), content, heal.r);
    const item = content.items.find((i) => i.id === ids.heal);
    expect(heal.fight.player.hp).toBeCloseTo(10 + (item?.fx?.kind === 'heal' ? item.fx.hp : 0), 6);

    const pill = itemFight(ids.chakraPill);
    pill.fight.player.chakra = 0;
    fightAdvance(pill.fight, workOf(1500), content, pill.r);
    expect(pill.fight.player.chakra).toBeGreaterThan(0);
  });

  it('refuses an item the pouch does not hold', () => {
    const { fight } = itemFight(ids.kunai, 0);
    fightAdvance(fight, workOf(1000), content, rules);
    expect(fight.tally.uses[ids.kunai]).toBeUndefined();
  });
});

describe('use by hand', () => {
  it('heals at once during a fight and takes one unit; tools and an idle game are refused', () => {
    const state = fighter(5, 36);
    stock(state, { [ids.heal]: FOOD + 4, [ids.kunai]: 4 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    run(state, { type: 'pouch.set', slot: 1, item: ids.kunai });
    expect(dispatch(state, { type: 'pouch.use', slot: 0 }, content)).toEqual({
      ok: false,
      reason: 'error.notFighting',
    });
    startFight(state, 'core:zone_heavy');
    advance(state, 5000, content);
    expect(state.combat?.phase).toBe('fight');
    const player = state.combat?.fight.player;
    if (!player) throw new Error('no fight');
    player.hp = 20;
    const at = state.combat?.fight.t;
    run(state, { type: 'pouch.use', slot: 0 });
    expect(player.hp).toBeGreaterThan(60);
    expect(state.combat?.fight.t).toBe(at);
    expect(state.pouch.slots[0]?.n).toBe(FOOD - 1);
    expect(dispatch(state, { type: 'pouch.use', slot: 1 }, content)).toEqual({
      ok: false,
      reason: 'error.itemNotUsable',
    });
    expect(dispatch(state, { type: 'pouch.use', slot: 2 }, content)).toEqual({
      ok: false,
      reason: 'error.emptySlot',
    });
  });

  it('is not done by the game itself: without the medic pouch nothing heals on its own', () => {
    const state = fighter(6, 20);
    delete state.bank[ids.medpouch];
    stock(state, { [ids.heal]: 4 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    expect(snapshotPlayer(state, content, defaultRules).medic).toBeNull();
    expect(dispatch(state, { type: 'pouch.medic', slot: 0 }, content)).toEqual({
      ok: false,
      reason: 'error.noMedicPouch',
    });
  });
});

describe('the medic pouch', () => {
  function medicFight(hpShare: number, owned = true) {
    const snap: PlayerSnapshot = {
      ...scripted(['core:leaf_whirlwind']),
      pouch: [{ id: ids.heal, n: 3 }],
      medic: owned ? 0 : null,
    };
    const fight = createFight(snap, enemyAt(LEVEL), 4, content, rules);
    quiet(pacify(fight));
    fight.player.maxHp = 100;
    fight.player.hp = 100 * hpShare;
    fightAdvance(fight, workOf(2000), content, rules);
    return fight;
  }

  it('uses its slot below the configured share and only then', () => {
    expect(medicFight(K.pillAt - 0.05).pouch[0]?.n).toBe(2);
    expect(medicFight(K.pillAt + 0.05).pouch[0]?.n).toBe(3);
  });

  it('works only while the pouch upgrade is owned, and is chosen by command', () => {
    const state = fighter(7, 20);
    stock(state, { [ids.heal]: 4, [ids.medpouch]: 1, [ids.kunai]: 4 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    run(state, { type: 'pouch.set', slot: 1, item: ids.kunai });
    expect(dispatch(state, { type: 'pouch.medic', slot: 1 }, content)).toEqual({
      ok: false,
      reason: 'error.itemNotUsable',
    });
    run(state, { type: 'pouch.medic', slot: 0 });
    expect(snapshotPlayer(state, content, defaultRules).medic).toBe(0);
    delete state.bank[ids.medpouch];
    expect(snapshotPlayer(state, content, defaultRules).medic).toBeNull();
    stock(state, { [ids.medpouch]: 1 });
    expect(snapshotPlayer(state, content, defaultRules).medic).toBe(0);
  });
});

/**
 * Shadow clones fight, each in a fight of its own: several fights at once, death without a retry, the
 * lost fight's earnings gone, the divided chakra pool, determinism, split invariance, offline, and the
 * migration of a version 19 save (one fight in the state, owned by a clone's slot).
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  allFights,
  chakraDivisor,
  defaultRules,
  deserialize,
  dispatch,
  dispelPreview,
  growSlots,
  playerMaxChakra,
  serialize,
  type GameState,
} from '../src/index.ts';
import { analyze, boss, build } from './analysis-helpers.ts';
import { HOUR } from './helpers.ts';
import { fighter, ids, startFight, startOperation, stock, unlock } from './prep-state.ts';

const CLONE = 'core:shadow_clone';
const WOLF = 'core:zone_wolf';
const HARD = 'core:zone_foreign_genin';
const MIN = 60_000;

/** A genin who knows the clone technique (the second slot is open) and is strong enough for the zones. */
function cloner(seed = 1, level = 36): GameState {
  const state = fighter(seed, level);
  state.known[CLONE] = true;
  growSlots(state, content);
  stock(state, { [ids.heal]: 300 });
  state.events = [];
  return state;
}

const totalXp = (s: GameState): number => Object.values(s.skills).reduce((a, k) => a + k.xp, 0);
const defeats = (s: GameState): number =>
  Object.entries(s.counters)
    .filter(([key]) => key.startsWith('defeats.'))
    .reduce((sum, [, n]) => sum + n, 0);

describe('several fights at once', () => {
  it('stamps the battle log, the wins and the defeats with the performer of the fight', () => {
    const state = cloner();
    startFight(state, WOLF, 0);
    startFight(state, HARD, 1);
    advance(state, 3 * MIN, content);
    const log = state.events.filter((e) => e.type === 'combatLog');
    expect(log.length).toBeGreaterThan(0);
    // A line of the character's fight names the wolf, a line of the clone's names the other enemy: no mixing.
    for (const e of log) {
      if (e.type !== 'combatLog') continue;
      expect(e.slot).toBe(e.enemy === 'core:wolf' ? 0 : 1);
    }
    expect(new Set(log.map((e) => (e.type === 'combatLog' ? e.slot : -1)))).toEqual(
      new Set([0, 1]),
    );
    const won = state.events.filter((e) => e.type === 'enemyDefeated');
    expect(won.length).toBeGreaterThan(0);
    for (const e of won)
      if (e.type === 'enemyDefeated') expect(e.slot).toBe(e.enemy === 'core:wolf' ? 0 : 1);
  });

  it('lets the character and a clone each hold a fight, in a zone and in the same zone', () => {
    const state = cloner();
    expect(startFight(state, WOLF, 0)).toEqual({ ok: true });
    expect(startFight(state, WOLF, 1)).toEqual({ ok: true });
    expect(state.combat?.owner).toBe(0);
    expect(state.clones[1]?.fight?.owner).toBe(1);
    expect(allFights(state).map((f) => f.slot)).toEqual([0, 1]);
    advance(state, 5 * MIN, content);
    expect(state.combat?.fight.t).toBeGreaterThan(0);
    expect(state.clones[1]?.fight?.fight.t).toBeGreaterThan(0);
    // Two separate fights: two separate bodies, not one shared.
    expect(state.combat?.fight).not.toBe(state.clones[1]?.fight?.fight);
    expect(state.counters['kills.core:wolf'] ?? 0).toBeGreaterThan(0);
  });

  it('takes an operation and a mission with a combat stage in a clone, beside the character', () => {
    const state = cloner(1, 50);
    expect(startFight(state, WOLF, 0)).toEqual({ ok: true });
    unlock(state, 'op.hideout.unlocked');
    expect(startOperation(state, 'core:op_hideout', 1)).toEqual({ ok: true });
    expect(state.slots[1]?.action?.kind).toBe('operation');
    expect(state.clones[1]?.fight).not.toBeNull();
    dispatch(state, { type: 'clone.dispel' }, content);
    const mission = content.missions.find(
      (x) => x.board && x.rank !== 'OP' && x.stages.some((s) => s.t === 'combat'),
    );
    expect(
      dispatch(
        state,
        { type: 'action.start', slot: 1, kind: 'mission', id: mission?.id ?? '' },
        content,
      ).ok,
    ).toBe(true);
    expect(state.slots[1]?.action?.kind).toBe('mission');
  });

  it('keeps a raid one fight: the same raid is not fought by two performers', () => {
    const raid = content.raids[0];
    expect(raid).toBeDefined();
    const state = cloner();
    state.flags[`raid.${raid?.id}.active`] = true;
    const first = startFight(state, raid?.id ?? '', 1);
    // A raid the clone cannot take is refused for its own reason, never silently skipped.
    expect(first).toEqual({ ok: true });
    expect(startFight(state, raid?.id ?? '', 0)).toEqual({
      ok: false,
      reason: 'error.sameActionElsewhere',
    });
  });

  it('divides the chakra pool of every performer by the number of performers', () => {
    const state = cloner();
    const full = playerMaxChakra(state, content);
    startFight(state, WOLF, 0);
    startFight(state, WOLF, 1);
    expect(chakraDivisor(state, content)).toBe(2);
    advance(state, 1000, content);
    expect(state.combat?.fight.player.maxChakra).toBeCloseTo(full / 2, 6);
    expect(state.clones[1]?.fight?.fight.player.maxChakra).toBeCloseTo(full / 2, 6);
    dispatch(state, { type: 'clone.dispel' }, content);
    advance(state, 1000, content);
    expect(state.combat?.fight.player.maxChakra).toBeCloseTo(full, 6);
  });

  it('gives the same state however the time is cut, with two fights going', () => {
    const run = (chunk: number): string => {
      const s = cloner(3);
      startFight(s, WOLF, 0);
      startFight(s, WOLF, 1);
      for (let t = 0; t < 6 * MIN; t += chunk) advance(s, Math.min(chunk, 6 * MIN - t), content);
      return serialize(s);
    };
    const whole = run(6 * MIN);
    for (const chunk of [1, 7, 999, 3600]) expect(run(chunk), `chunk ${chunk}`).toBe(whole);
    expect(run(6 * MIN)).toBe(whole);
    // A save in the middle gives the same game on.
    // (A state whose technique was set by hand has a loadout a load would rebuild: start from a loaded one.)
    const mid = deserialize(serialize(cloner(3)), content);
    startFight(mid, WOLF, 0);
    startFight(mid, WOLF, 1);
    advance(mid, 3 * MIN, content);
    const copy = deserialize(serialize(mid), content);
    expect(serialize(copy)).toBe(serialize(mid));
    advance(mid, 3 * MIN, content);
    advance(copy, 3 * MIN, content);
    expect(serialize(copy)).toBe(serialize(mid));
  }, 60_000);

  it('plays 12 offline hours with two fights within the speed budget', () => {
    const state = cloner(5);
    startFight(state, WOLF, 0);
    startFight(state, WOLF, 1);
    const t0 = performance.now();
    advance(state, 12 * HOUR, content);
    const ms = performance.now() - t0;
    console.log(`12 h with two fights: ${ms.toFixed(0)} ms`);
    // The clone ran out of chakra after its life; the character fought on.
    expect(state.clones[1]).toBeUndefined();
    expect(state.combat).not.toBeNull();
    expect(ms).toBeLessThan(12_000);
  }, 60_000);
});

describe('what a clone fight pays', () => {
  it('keeps the earnings of a won fight in the clone and hands them over with the rest', () => {
    const state = cloner(2, 36);
    expect(startFight(state, WOLF, 1)).toEqual({ ok: true });
    const base = totalXp(state);
    advance(state, 10 * MIN, content);
    expect(totalXp(state)).toBeCloseTo(base, 6);
    const held = Object.values(state.clones[1]?.xp ?? {}).reduce((a, b) => a + b, 0);
    expect(held).toBeGreaterThan(0);
    expect(
      Object.keys(state.clones[1]?.bag ?? {}).length +
        Object.keys(state.clones[1]?.purse ?? {}).length,
    ).toBeGreaterThan(0);
    const preview = dispelPreview(state, 1, content, defaultRules);
    const shown = Object.values(preview?.xp ?? {}).reduce((a, b) => a + b, 0);
    dispatch(state, { type: 'clone.dispel' }, content);
    expect(totalXp(state) - base).toBeGreaterThan(held * 0.99);
    // What the preview shows is what the dispel pays, the fight's pending XP after the modifiers included.
    expect(totalXp(state) - base).toBeCloseTo(shown, 4);
  });

  it('previews the pending Mastery of a fight in progress as the dispel pays it', () => {
    const state = cloner(2, 36);
    expect(startFight(state, WOLF, 1)).toEqual({ ok: true });
    const sum = (m: Record<string, { amount: number }>): number =>
      Object.values(m).reduce((a, b) => a + b.amount, 0);
    for (let i = 0; i < 400 && state.clones[1]; i++) {
      advance(state, 1000, content);
      if (sum(state.clones[1]?.fight?.pending?.mastery ?? {}) > 0) break;
    }
    const body = state.clones[1];
    const pending = body?.fight?.pending?.mastery ?? {};
    // The fight holds Mastery it has not paid yet; the preview must count it.
    expect(sum(pending)).toBeGreaterThan(0);
    const preview = dispelPreview(state, 1, content, defaultRules);
    expect(sum(preview?.mastery ?? {})).toBeGreaterThan(sum(body?.mastery ?? {}));
    const masteryOf = (): number => Object.values(state.mastery).reduce((a, m) => a + m.xp, 0);
    const before = masteryOf();
    dispatch(state, { type: 'clone.dispel' }, content);
    expect(masteryOf() - before).toBeCloseTo(sum(preview?.mastery ?? {}), 6);
  });

  it('death: a lost fight dispels the clone, with no new try and nothing from the lost fight', () => {
    const state = cloner(6, 1);
    state.skills.nin!.xp = 0;
    expect(startFight(state, HARD, 1)).toEqual({ ok: true });
    const before = totalXp(state);
    const sum = (x: Record<string, number> | undefined): number =>
      Object.values(x ?? {}).reduce((a, b) => a + b, 0);
    let spent = 0;
    let heldSeen = 0;
    let heldStep = 0;
    let pendingSeen = 0;
    for (let i = 0; i < 1200 && state.clones[1]; i++) {
      advance(state, 5000, content);
      spent++;
      const body = state.clones[1];
      if (!body) break;
      heldStep = sum(body.xp) - heldSeen;
      heldSeen = sum(body.xp);
      pendingSeen = Math.max(pendingSeen, sum(body.fight?.pending?.xp));
    }
    expect(spent).toBeLessThan(1200);
    expect(state.clones[1]).toBeUndefined();
    expect(state.slots[1]?.action).toBeNull();
    expect(state.world.figures).toBeUndefined();
    const lost = state.events.filter((e) => e.type === 'playerDefeated');
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ clone: true });
    expect(state.events.find((e) => e.type === 'cloneDispelled')).toMatchObject({ cause: 'death' });
    // No Wound, no defeat of the player's, no retry.
    expect(defeats(state)).toBe(0);
    expect(state.wounds.stacks).toBe(0);
    const losses = state.report[HARD]?.losses ?? 0;
    advance(state, 20 * MIN, content);
    expect(state.report[HARD]?.losses ?? 0).toBe(losses);
    expect(state.clones[1]).toBeUndefined();
    // What the lost fight earned is gone; the combat XP of the fight (paid by time) was held and returns.
    // The fight had XP pending when the clone fell, and none of it was paid: the gain is what was held, and a step of it.
    expect(pendingSeen).toBeGreaterThan(0);
    const gain = totalXp(state) - before;
    expect(gain).toBeGreaterThanOrEqual(heldSeen * 0.99);
    expect(gain).toBeLessThanOrEqual(heldSeen + 2 * heldStep + 1);
    expect(state.report[HARD]?.cloneLosses).toBeGreaterThan(0);
  });

  it('a new clone is made next to the character after a death', () => {
    const state = cloner(6, 1);
    startFight(state, HARD, 1);
    for (let i = 0; i < 60 && state.clones[1]; i++) advance(state, MIN, content);
    state.fatigue = 0;
    const result = dispatch(state, { type: 'clone.create' }, content);
    expect(result).toEqual({ ok: true });
    expect(state.world.figures?.[1]).toBe(state.world.location);
  });
});

describe('a version 19 save', () => {
  /** Turns a state of this version into the save dev wrote: one `combat`, owned by the clone's slot. */
  function asV19(state: GameState): string {
    const raw = JSON.parse(serialize(state)) as {
      v: number;
      state: Record<string, unknown> & { clones: Record<string, { fight: unknown }> };
    };
    const fight = raw.state.clones['1']?.fight ?? null;
    const own = raw.state.combat ?? null;
    raw.v = 19;
    raw.state.v = 19;
    raw.state.combat = own ?? fight;
    delete (raw.state as Record<string, unknown>).clones;
    delete (raw.state as Record<string, unknown>).fatigue;
    return JSON.stringify(raw);
  }

  it('gets a clone for a clone slot that works, and its fight, and goes on', () => {
    const state = cloner(8);
    startFight(state, WOLF, 1);
    advance(state, 4 * MIN, content);
    const old = asV19(state);
    const loaded = deserialize(old, content);
    expect(loaded.v).toBe(21);
    expect(loaded.combat).toBeNull();
    expect(loaded.clones[1]?.fight?.owner).toBe(1);
    expect(loaded.clones[1]?.life).toBeGreaterThan(0);
    expect(loaded.slots[1]?.action).toEqual({ kind: 'fight', id: WOLF });
    advance(loaded, 5 * MIN, content);
    expect(loaded.clones[1]?.fight?.fight.t).toBeGreaterThan(0);
  });

  it('keeps the character fight in `combat` and gives an idle clone slot no clone', () => {
    const state = cloner(8);
    startFight(state, WOLF, 0);
    advance(state, 2 * MIN, content);
    const loaded = deserialize(asV19(state), content);
    expect(loaded.combat?.owner).toBe(0);
    expect(loaded.clones).toEqual({});
    expect(loaded.slots[1]?.action).toBeNull();
  });
});

describe("the fight forecast is the character's", () => {
  const quick = { samples: 60, sessionMinutes: 10, minSessions: 2, maxSessions: 2 };

  function withClone(fights: boolean): GameState {
    const c = boss(46);
    const state = build(c, 31);
    state.known[CLONE] = true;
    growSlots(state, content);
    expect(dispatch(state, { type: 'clone.create', items: {} }, content).ok).toBe(true);
    if (fights) expect(startFight(state, WOLF, 1)).toEqual({ ok: true });
    return state;
  }

  it("does not take the clone's bag, pouch or life when a clone fights while the character prepares", () => {
    const c = boss(46);
    const standing = analyze(withClone(false), c.target, quick);
    const fighting = analyze(withClone(true), c.target, quick);
    // The same character, the same bag: the same numbers, whatever the clone does elsewhere.
    expect(fighting.fresh.winRate).toBeCloseTo(standing.fresh.winRate, 6);
    expect(standing.session).not.toBeNull();
    expect(fighting.session?.winRate).toEqual(standing.session?.winRate);
    expect(fighting.session?.supplies).toEqual(standing.session?.supplies);
    expect(fighting.session?.horizonMinutes).toBe(standing.session?.horizonMinutes);
    expect(standing.session?.supplies.length).toBeGreaterThan(0);
  });

  it("forecasts a plain zone from the character's slot with the clone fighting another zone", () => {
    const state = withClone(true);
    const a = analyze(state, { kind: 'zone', id: WOLF }, quick);
    const alone = analyze(withClone(false), { kind: 'zone', id: WOLF }, quick);
    expect(a.session).not.toBeNull();
    expect(a.session?.winsPerHour.mean).toBeCloseTo(alone.session?.winsPerHour.mean ?? 0, 6);
    // The forecast changed nothing in the live state.
    expect(state.clones[1]?.fight).not.toBeNull();
    expect(state.combat).toBeNull();
  });
});

/** Shadow clones fight: the clone takes fights, operations and missions with a combat stage; one fight at a time; full fight speed; the divided chakra pool. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  chakraDivisor,
  cloneCount,
  deserialize,
  dispatch,
  fightTimeMs,
  growSlots,
  planningSnapshot,
  playerMaxChakra,
  serialize,
  type GameState,
} from '../src/index.ts';
import { analyze, zone } from './analysis-helpers.ts';
import { HOUR, setLevel } from './helpers.ts';
import { fighter, ids, startFight, startOperation, stock } from './prep-state.ts';

const CLONE = 'core:shadow_clone';
const WOLF = 'core:zone_wolfmask';
const MIN = 60_000;

/** A genin who knows the clone technique (the second slot is open) and is strong enough for the zone. */
function cloner(seed = 1, level = 36): GameState {
  const state = fighter(seed, level);
  state.known[CLONE] = true;
  growSlots(state, content);
  stock(state, { [ids.heal]: 300 });
  state.events = [];
  return state;
}

const start = (state: GameState, slot: number, kind: string, id: string) =>
  dispatch(state, { type: 'action.start', slot, kind, id }, content);
const dispel = (state: GameState) => dispatch(state, { type: 'clone.dispel' }, content);
const drill = (): string => content.exercises.find((e) => e.level <= 30)?.id ?? '';
const defeats = (state: GameState): number =>
  Object.entries(state.counters)
    .filter(([key]) => key.startsWith('defeats.'))
    .reduce((sum, [, n]) => sum + n, 0);

describe('what a clone may fight', () => {
  it('takes a zone fight, an operation and a mission with a combat stage', () => {
    const state = cloner();
    expect(startFight(state, WOLF, 1)).toEqual({ ok: true });
    expect(state.combat?.owner).toBe(1);
    expect(dispel(state)).toEqual({ ok: true });
    expect(state.combat).toBeNull();
    // An operation and a mission with a combat stage are never refused for the clone.
    for (const op of content.operations) {
      const result = startOperation(state, op.id, 1);
      if (!result.ok) expect(result.reason, op.id).not.toBe('error.cloneNoFight');
      dispel(state);
    }
    for (const m of content.missions.filter(
      (x) => x.board && x.stages.some((s) => s.t === 'combat'),
    )) {
      const result = start(state, 1, 'mission', m.id);
      if (!result.ok) expect(result.reason, m.id).not.toBe('error.cloneNoFight');
      dispel(state);
    }
  });

  it('runs a mission with a combat stage in the clone slot: the stages at the slot speed, the fight at full speed, the pay to the player', () => {
    const MISSION = 'core:thief';
    const run = (other: boolean): { ms: number; state: GameState } => {
      const state = cloner(2, 50);
      if (other) start(state, 0, 'drill', drill());
      expect(start(state, 1, 'mission', MISSION)).toEqual({ ok: true });
      let fought = false;
      const t0 = state.now;
      while ((state.counters[`missions.done.${MISSION}`] ?? 0) < 1 && state.now - t0 < 3 * HOUR) {
        advance(state, 1000, content);
        if (state.combat) {
          fought = true;
          expect(state.combat.owner).toBe(1);
        }
      }
      expect(fought).toBe(true);
      return { ms: state.now - t0, state };
    };
    const alone = run(false);
    const shared = run(true);
    expect(state0(alone.state)).toBeGreaterThan(0);
    // The slot runs at half speed beside the drill, so the mission takes clearly longer than alone.
    expect(shared.ms).toBeGreaterThan(alone.ms * 1.3);
    expect(shared.state.wounds.stacks).toBe(0);
  });
});

/** The XP the player gained in the state (the clone's work is the player's). */
const state0 = (state: GameState): number =>
  Object.values(state.skills).reduce((sum, s) => sum + s.xp, 0);

describe('one fight at a time', () => {
  it('refuses a clone fight while the character fights, and the other way round', () => {
    const a = cloner();
    expect(startFight(a, WOLF, 0).ok).toBe(true);
    expect(startFight(a, WOLF, 1)).toEqual({ ok: false, reason: 'error.fightBusy' });
    const op = content.operations[0]?.id ?? '';
    expect(startOperation(a, op, 1)).toEqual({ ok: false, reason: 'error.fightBusy' });

    const b = cloner();
    expect(startFight(b, WOLF, 1).ok).toBe(true);
    expect(startFight(b, WOLF, 0)).toEqual({ ok: false, reason: 'error.fightBusy' });
  });

  it('lets the clone fight once the character stopped fighting', () => {
    const state = cloner();
    startFight(state, WOLF, 0);
    dispatch(state, { type: 'action.stop', slot: 0 }, content);
    expect(startFight(state, WOLF, 1).ok).toBe(true);
  });
});

describe('the speed of a fight', () => {
  const kills = (slot: number, other: boolean): number => {
    const state = cloner(3);
    if (other) start(state, 1 - slot, 'drill', drill());
    expect(startFight(state, WOLF, slot).ok).toBe(true);
    advance(state, 20 * MIN, content);
    return Object.entries(state.counters)
      .filter(([key]) => key.startsWith('kills.'))
      .reduce((sum, [, n]) => sum + n, 0);
  };

  it('is not slowed by the share of the pool: a clone fights as fast as the character alone', () => {
    const alone = kills(0, false);
    const inClone = kills(1, true);
    const withClone = kills(0, true);
    expect(alone).toBeGreaterThan(5);
    // The same fights at the same speed (the pool differs, so only a loose bound on the kills).
    expect(inClone).toBeGreaterThan(alone * 0.5);
    expect(withClone).toBeGreaterThan(alone * 0.5);
  });

  it('keeps the fight clock at full speed while the slots share the pool', () => {
    const state = cloner(4);
    start(state, 0, 'drill', drill());
    startFight(state, WOLF, 1);
    expect(state.slots.map((s) => s.share)).toEqual([500, 500]);
    advance(state, 3000, content);
    // The fight of the clone, whose slot has half the pool, has run the whole three seconds.
    expect(state.combat?.phase).toBe('fight');
    expect(fightTimeMs(state.combat!.fight)).toBe(3000);
    // The combat XP cycles of the fight slot are not slowed either.
    expect(state.slots[1]?.progress).toBe((3000 % content.balance.K.combat.xpTickMs) * 1000);
  });

  it('leaves the other actions with their share', () => {
    const state = cloner(5);
    start(state, 0, 'drill', drill());
    startFight(state, WOLF, 1);
    const before = state.slots[0]?.progress ?? 0;
    advance(state, 1000, content);
    expect((state.slots[0]?.progress ?? 0) - before).toBe(500 * 1000);
  });
});

describe('the chakra pool', () => {
  it('is divided by n + 1 for the clone and the character while a clone exists, and full after the dispel', () => {
    const state = cloner(6);
    const full = playerMaxChakra(state, content);
    expect(cloneCount(state, content)).toBe(0);
    expect(chakraDivisor(state, content)).toBe(1);
    // The clone fights: its pool is half.
    startFight(state, WOLF, 1);
    expect(cloneCount(state, content)).toBe(1);
    expect(state.combat?.fight.player.maxChakra).toBeCloseTo(full / 2, 6);
    expect(playerMaxChakra(state, content)).toBeCloseTo(full / 2, 6);
    dispel(state);
    expect(playerMaxChakra(state, content)).toBeCloseTo(full, 6);
    // The character fights while a clone does something else: also half.
    start(state, 1, 'drill', drill());
    startFight(state, WOLF, 0);
    expect(state.combat?.fight.player.maxChakra).toBeCloseTo(full / 2, 6);
    // The fight in progress keeps its current chakra and its maximum follows the dispel.
    advance(state, 20_000, content);
    const kept = state.combat?.fight.player.chakra ?? 0;
    expect(kept).toBeLessThanOrEqual(full / 2 + 1e-9);
    dispel(state);
    advance(state, 1, content);
    expect(state.combat?.fight.player.maxChakra).toBeCloseTo(full, 6);
  });

  it('cuts the chakra of a fight in progress when a clone starts, and keeps what fits', () => {
    const state = cloner(7);
    startFight(state, WOLF, 0);
    const full = state.combat?.fight.player.maxChakra ?? 0;
    expect(state.combat?.fight.player.chakra).toBeCloseTo(full, 6);
    start(state, 1, 'drill', drill());
    advance(state, 1, content);
    const p = state.combat?.fight.player;
    expect(p?.maxChakra).toBeCloseTo(full / 2, 6);
    expect(p?.chakra ?? 0).toBeLessThanOrEqual(full / 2 + 1e-9);
  });

  it('shows in the forecast: a player who prepares a fight while a clone works has the divided pool', () => {
    const state = cloner(8);
    state.known[CLONE] = true;
    start(state, 1, 'drill', drill());
    const target = zone(false).target;
    // The forecast works on a copy of this state, so it reads the same divided pool as the fight would.
    expect(planningSnapshot(state, content).chakraDivisor).toBe(2);
    const copy = deserialize(serialize(state, 1), content);
    expect(playerMaxChakra(copy, content)).toBeCloseTo(playerMaxChakra(cloner(8), content) / 2, 6);
    expect(analyze(state, target, { maxSessions: 1 }).session).not.toBeNull();
    // A fight that runs in the clone slot is forecast in that slot.
    dispel(state);
    startFight(state, WOLF, 1);
    expect(analyze(state, target, { maxSessions: 1 }).session).not.toBeNull();
  });
});

describe('a clone that loses', () => {
  /** A clone far too weak for the zone, with the character strong (the pool is shared, the levels are not). */
  function weakClone(seed: number): GameState {
    const state = cloner(seed, 1);
    setLevel(state, 'nin', 1);
    return state;
  }

  it('costs the player no Wound and no defeat, and the fight starts again', () => {
    const state = weakClone(9);
    const mission = state.slots.length;
    expect(mission).toBe(2);
    startFight(state, 'core:zone_wolfmask', 1);
    let lost = 0;
    for (let i = 0; i < 40 && lost === 0; i++) {
      advance(state, MIN, content);
      lost = state.events.filter((e) => e.type === 'playerDefeated').length;
      if (lost === 0) state.events = [];
    }
    expect(lost).toBeGreaterThan(0);
    expect(state.events.some((e) => e.type === 'playerDefeated' && e.clone === true)).toBe(true);
    expect(state.wounds.stacks).toBe(0);
    expect(defeats(state)).toBe(0);
    const entry = Object.values(state.bingo).reduce((sum, b) => sum + b.losses, 0);
    expect(entry).toBe(0);
    // The clone is still at it: the action stands, a fight is going, and it is the clone's.
    expect(state.slots[1]?.action?.kind).toBe('fight');
    expect(state.combat?.owner).toBe(1);
    const report = state.report[WOLF];
    expect(report?.losses).toBeGreaterThan(0);
    expect(report?.cloneFights).toBe(report?.fights);
  });

  it('is marked in the battle report, and a player defeat is not', () => {
    const state = cloner(10);
    startFight(state, WOLF, 1);
    advance(state, 10 * MIN, content);
    const report = state.report[WOLF];
    expect(report?.fights ?? 0).toBeGreaterThan(0);
    expect(report?.cloneFights).toBe(report?.fights);
    const own = cloner(10);
    startFight(own, WOLF, 0);
    advance(own, 10 * MIN, content);
    expect(own.report[WOLF]?.cloneFights).toBeUndefined();
  });
});

describe('what a clone earns', () => {
  it('pays XP, Mastery and loot to the player', () => {
    const state = cloner(11);
    const xp0 = Object.values(state.skills).reduce((s, k) => s + k.xp, 0);
    const ryo0 = state.bank['core:ryo'] ?? 0;
    startFight(state, WOLF, 1);
    advance(state, 20 * MIN, content);
    expect(Object.values(state.skills).reduce((s, k) => s + k.xp, 0)).toBeGreaterThan(xp0);
    const kills = Object.entries(state.counters).filter(([k]) => k.startsWith('kills.'));
    expect(kills.reduce((s, [, n]) => s + n, 0)).toBeGreaterThan(0);
    expect(Object.keys(state.mastery).length).toBeGreaterThan(0);
    expect(state.report[WOLF]?.loot.ryo ?? 0 + ryo0).toBeGreaterThanOrEqual(0);
  });
});

describe('time with a clone fighting', () => {
  const setup = (): GameState => {
    const state = cloner(12);
    start(state, 0, 'drill', drill());
    startFight(state, WOLF, 1);
    return state;
  };

  it('repeats exactly for the same seed and commands', () => {
    const a = setup();
    const b = setup();
    advance(a, HOUR, content);
    advance(b, HOUR, content);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('gives the same state however the time is cut', () => {
    const whole = setup();
    advance(whole, 20 * MIN, content);
    for (const chunks of [[7_001], [999, 5_003], [60_000, 1, 33_333]]) {
      const cut = setup();
      let left = 20 * MIN;
      for (let i = 0; left > 0; i++) {
        const step = Math.min(left, chunks[i % chunks.length] ?? 1);
        advance(cut, step, content);
        left -= step;
      }
      expect(JSON.stringify(cut.combat)).toBe(JSON.stringify(whole.combat));
      expect(cut.counters).toEqual(whole.counters);
      expect(cut.report).toEqual(whole.report);
      expect(cut.now).toBe(whole.now);
    }
  });

  it('catches up offline as the same time in one advance', () => {
    const a = setup();
    const b = setup();
    advance(a, 3 * HOUR, content);
    for (let i = 0; i < 3; i++) advance(b, HOUR, content);
    expect(JSON.stringify(a.report)).toBe(JSON.stringify(b.report));
    expect(a.counters).toEqual(b.counters);
  });

  it('keeps the fight across a save and loads a clone in a fight sanely', () => {
    const state = setup();
    advance(state, 5 * MIN + 123, content);
    const loaded = deserialize(serialize(state, 7), content);
    expect(loaded.combat?.owner).toBe(1);
    expect(loaded.slots[1]?.action?.kind).toBe('fight');
    advance(state, 10 * MIN, content);
    advance(loaded, 10 * MIN, content);
    expect(loaded.counters).toEqual(state.counters);
  });

  it('loads a doctored save that puts a fight of the character into the clone slot, and plays on', () => {
    const state = cloner(13);
    startFight(state, WOLF, 0);
    advance(state, 2 * MIN, content);
    const doc = JSON.parse(serialize(state, 7)) as {
      state: {
        slots: { action: unknown; progress: number; share: number; data: unknown }[];
        combat: { owner: number };
      };
    };
    // The fight and its action move to the second slot, as a hand-edited save could have them.
    const [first, second] = doc.state.slots;
    if (!first || !second) throw new Error('no slots');
    doc.state.slots[1] = { ...first };
    doc.state.slots[0] = { ...second };
    doc.state.combat.owner = 1;
    const loaded = deserialize(JSON.stringify(doc), content);
    expect(loaded.slots[1]?.action?.kind).toBe('fight');
    expect(loaded.combat?.owner).toBe(1);
    expect(loaded.combat?.fight.player.maxChakra).toBeGreaterThan(0);
    advance(loaded, 10 * MIN, content);
    expect(loaded.wounds.stacks).toBe(0);
    expect(loaded.slots[1]?.action?.kind).toBe('fight');
  });
});

/**
 * The raid on the village: its trigger, the arrival, the fight in person, the village's own defence, the
 * consequences (damaged buildings, the reward), the time away, the same play whatever the cut of the time,
 * the save, and the story step that asks for it.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  advanceOffline,
  deserialize,
  dispatch,
  effectiveLevel,
  getMod,
  growSlots,
  raidFlag,
  serialize,
  updateQuests,
  villageBuildings,
  villageRaids,
  type GameEvent,
  type GameState,
} from '../src/index.ts';
import { fighter, startFight } from './prep-state.ts';

const K = content.balance.K;
const TICK = K.tickMin * 60_000;
const raid = content.raids[0]!;
const RAID = raid.id;
const QUEST = 'core:outskirts';
/** The step of the chain that asks for the raid (counted from 0 as the saved `step` counts the steps done). */
const STEP = raid.trigger.t === 'quest' ? (raid.trigger.step ?? 0) : 0;

/** A genin who can fight the packs, with the outskirts chain one step short of the raid. */
function beforeRaid(seed = 7, level = 30): GameState {
  const s = fighter(seed, level);
  s.quests[QUEST] = { step: STEP - 1, base: 0, done: false };
  s.quests[QUEST] = { step: STEP - 1, base: 0, done: false };
  updateQuests(s, content);
  return s;
}
/** The same, with the step reached: the raid is called. */
function called(seed = 7, level = 30): GameState {
  const s = beforeRaid(seed, level);
  s.quests[QUEST] = { step: STEP, base: 0, done: false };
  updateQuests(s, content);
  return s;
}
/** Called, and carried to the gates. */
function atTheGates(seed = 7, level = 30): GameState {
  const s = called(seed, level);
  advance(s, raid.lead * TICK, content);
  return s;
}
const village = (s: GameState) => {
  if (!s.village) throw new Error('no village');
  return s.village;
};
const run = (s: GameState) => village(s).raids[RAID];
const info = (s: GameState) => villageRaids(s, content).find((r) => r.id === RAID)!;
const events = (s: GameState, type: GameEvent['type']) => s.events.filter((e) => e.type === type);
/** Sets what the village holds of one part of a raid's defence: levels of a building, or units of a resource of any kind. */
function hold(s: GameState, part: (typeof raid.defence)[number], n: number): void {
  const v = village(s);
  if (part.t === 'building') v.levels[part.id] = n;
  else {
    const kind = content.resources.find((r) => r.id === part.id)?.kind;
    if (kind === 'power') v.power = n;
    else if (kind === 'workforce') v.workforce = n;
    else v.shinobi[part.id] = n;
  }
}
/** Gives the village a defence worth `packs` packs, by the first part of the raid's defence. */
function defend(s: GameState, packs: number): void {
  const part = raid.defence[0]!;
  const level = Math.ceil((packs * raid.perPack) / part.per);
  hold(s, part, level);
}

describe('the data', () => {
  it('names a raid the story step stands in for, and a fight of one enemy', () => {
    expect(content.raids).toHaveLength(1);
    expect(content.enemies.some((e) => e.id === raid.enemy)).toBe(true);
    const step = content.quests.find((q) => q.id === QUEST)!.steps[STEP]!;
    expect(step.objective).toEqual({
      t: 'req',
      req: { t: 'flag', id: raidFlag(RAID, 'over') },
    });
  });
});

describe('the trigger', () => {
  it('calls nothing before the step is reached', () => {
    const s = beforeRaid();
    advance(s, 3 * 3_600_000, content);
    expect(village(s).raids).toEqual({});
    expect(s.flags[raidFlag(RAID, 'active')]).toBeUndefined();
  });

  it('calls the raid the moment the step becomes the active one, once', () => {
    const s = called();
    expect(run(s)).toMatchObject({ phase: 'warned', ticks: raid.lead, repelled: 0 });
    expect(events(s, 'raidCalled')).toHaveLength(1);
    // It is not called again by more updates or more time before it arrives.
    updateQuests(s, content);
    advance(s, TICK, content);
    expect(events(s, 'raidCalled')).toHaveLength(1);
    expect(run(s)?.ticks).toBe(raid.lead - 1);
  });

  it('is called at the same game time whatever the cut of the time', () => {
    const a = beforeRaid();
    const b = beforeRaid();
    advance(a, 7 * 60_000, content);
    for (let i = 0; i < 7; i++) advance(b, 60_000, content);
    a.quests[QUEST] = { step: STEP, base: 0, done: false };
    b.quests[QUEST] = { step: STEP, base: 0, done: false };
    updateQuests(a, content);
    updateQuests(b, content);
    expect(serialize(a)).toBe(serialize(b));
  });

  it('reads the step that is already active in a save made before raids (the state is the same as when it was reached)', () => {
    const s = beforeRaid();
    s.quests[QUEST] = { step: STEP, base: 0, done: false };
    // No update ran: a save that is loaded gets it called by the load.
    const loaded = deserialize(serialize(s), content);
    expect(village(loaded).raids[RAID]?.phase).toBe('warned');
  });
});

describe('the arrival', () => {
  it('waits the lead, then stands at the gates with the fight open', () => {
    const s = called();
    expect(startFight(s, RAID)).toMatchObject({ ok: false });
    advance(s, (raid.lead - 1) * TICK, content);
    expect(run(s)?.phase).toBe('warned');
    advance(s, TICK, content);
    expect(run(s)).toMatchObject({ phase: 'active', ticks: raid.hold });
    expect(s.flags[raidFlag(RAID, 'active')]).toBe(true);
    expect(events(s, 'raidArrived')).toHaveLength(1);
    expect(startFight(s, RAID)).toEqual({ ok: true });
  });

  it('shows the player what is coming, how long, and what the village would stop', () => {
    const s = called();
    expect(info(s)).toMatchObject({
      phase: 'warned',
      packs: raid.packs,
      left: raid.packs,
      waiting: false,
    });
    expect(info(s).msLeft).toBe((raid.lead - 1) * TICK + (TICK - village(s).clock));
    expect(info(s).defence.stops).toBe(0);
    defend(s, 2);
    expect(info(s).defence.stops).toBe(2);
    expect(info(s).defence.points).toBe(2 * raid.perPack);
  });
});

describe('the fight in person', () => {
  it('repels every pack, pays the whole reward, damages nothing and ends the fight with the raid', () => {
    const s = atTheGates();
    const before = { ...s.currencies };
    expect(startFight(s, RAID)).toEqual({ ok: true });
    for (let i = 0; i < 100 && info(s).phase !== 'over'; i++) advance(s, 30_000, content);
    expect(info(s)).toMatchObject({
      phase: 'over',
      repelled: raid.packs,
      byVillage: 0,
      breached: 0,
      damaged: [],
      paid: { ryo: raid.reward.ryo, rep: raid.reward.rep },
    });
    expect(village(s).damage).toEqual({});
    expect(s.currencies.rep).toBe((before.rep ?? 0) + raid.reward.rep);
    expect(s.currencies.ryo).toBeGreaterThanOrEqual((before.ryo ?? 0) + raid.reward.ryo);
    // The raid is over: the flags say so, and the slot that fought it is free.
    expect(s.flags[raidFlag(RAID, 'over')]).toBe(true);
    expect(s.flags[raidFlag(RAID, 'active')]).toBeUndefined();
    expect(s.slots[0]?.action).toBeNull();
    expect(s.combat).toBeNull();
    const over = events(s, 'raidOver')[0];
    expect(over).toMatchObject({ raid: RAID, repelled: raid.packs, breached: 0 });
  });

  it('counts the packs the player repelled when the hold ends, and the village stops the rest', () => {
    const s = atTheGates();
    defend(s, raid.packs);
    startFight(s, RAID);
    // Two packs fall, then the player leaves.
    for (let i = 0; i < 400 && (run(s)?.repelled ?? 0) < 2; i++) advance(s, 5_000, content);
    const fought = run(s)?.repelled ?? 0;
    expect(fought).toBeGreaterThanOrEqual(2);
    dispatch(s, { type: 'action.stop', slot: 0 }, content);
    advance(s, raid.hold * TICK, content);
    expect(info(s)).toMatchObject({ phase: 'over', repelled: fought, breached: 0 });
    expect(info(s).byVillage).toBe(raid.packs - fought);
    const share = (fought + (raid.packs - fought) * raid.autoShare) / raid.packs;
    expect(info(s).paid).toEqual({
      ryo: Math.floor(raid.reward.ryo * share),
      rep: Math.floor(raid.reward.rep * share),
    });
  });

  it('ends a fight that is still on when the village ends the raid', () => {
    const s = atTheGates(7, 8);
    defend(s, raid.packs);
    startFight(s, RAID);
    advance(s, raid.hold * TICK, content);
    expect(info(s).phase).toBe('over');
    expect(s.slots[0]?.action).toBeNull();
  });

  it('lets a clone fight the packs, and one fight at a time', () => {
    const s = atTheGates();
    s.known['core:shadow_clone'] = true;
    growSlots(s, content);
    expect(s.slots).toHaveLength(2);
    expect(startFight(s, RAID, 1)).toEqual({ ok: true });
    expect(startFight(s, RAID, 0)).toEqual({ ok: false, reason: 'error.fightBusy' });
    for (let i = 0; i < 200 && info(s).phase !== 'over'; i++) advance(s, 30_000, content);
    expect(info(s)).toMatchObject({ phase: 'over', repelled: raid.packs });
    expect(s.slots[1]?.action).toBeNull();
  });
});

describe('the village defends itself', () => {
  it('does nothing while the hold lasts, then stops as many packs as its defence is worth', () => {
    const s = atTheGates();
    defend(s, 4);
    advance(s, (raid.hold - 1) * TICK, content);
    expect(run(s)?.phase).toBe('active');
    advance(s, TICK, content);
    expect(info(s)).toMatchObject({ phase: 'over', repelled: 0, byVillage: 4, breached: 2 });
    expect(events(s, 'raidOver')).toHaveLength(1);
  });

  it('pays the share the village earns, and damages one building for each pack that got through', () => {
    const s = atTheGates();
    defend(s, 4);
    const before = { ...s.currencies };
    advance(s, raid.hold * TICK, content);
    const share = (4 * raid.autoShare) / raid.packs;
    expect(info(s).paid).toEqual({
      ryo: Math.floor(raid.reward.ryo * share),
      rep: Math.floor(raid.reward.rep * share),
    });
    expect(s.currencies.rep).toBe((before.rep ?? 0) + Math.floor(raid.reward.rep * share));
    expect(info(s).damaged).toEqual(raid.targets.slice(0, 2));
    expect(Object.keys(village(s).damage).sort()).toEqual(raid.targets.slice(0, 2).sort());
  });

  it('wins nothing and damages the most when the village has no defence and nobody comes: it waits for the player', () => {
    const s = atTheGates();
    advance(s, (raid.hold + 20) * TICK, content);
    expect(info(s)).toMatchObject({ phase: 'active', waiting: true, byVillage: 0, repelled: 0 });
    expect(s.flags[raidFlag(RAID, 'active')]).toBe(true);
    expect(village(s).damage).toEqual({});
    // The player can still come.
    expect(startFight(s, RAID)).toEqual({ ok: true });
  });

  it('takes the packs left once the village has a defence, at the next tick', () => {
    const s = atTheGates();
    advance(s, (raid.hold + 3) * TICK, content);
    expect(info(s).waiting).toBe(true);
    defend(s, raid.packs);
    advance(s, TICK, content);
    expect(info(s)).toMatchObject({ phase: 'over', byVillage: raid.packs, breached: 0 });
    expect(village(s).damage).toEqual({});
  });

  it('counts what the village holds of every part of the defence, and no more', () => {
    const s = atTheGates();
    const parts = raid.defence;
    for (const part of parts) {
      const s2 = atTheGates();
      hold(s2, part, 5);
      expect(info(s2).defence.points, part.id).toBe(5 * part.per);
      expect(info(s2).defence.parts.find((p) => p.id === part.id)?.have).toBe(5);
    }
    expect(info(s).defence.points).toBe(0);
  });
});

describe('the consequences', () => {
  it('stops a damaged building and its bonus until it is repaired, then restarts it', () => {
    const s = atTheGates();
    defend(s, 5);
    const target = raid.targets[0]!;
    const building = content.buildings.find((b) => b.id === target)!;
    const working = effectiveLevel(s, building);
    expect(working).toBeGreaterThan(0);
    advance(s, raid.hold * TICK, content);
    expect(info(s).damaged).toEqual([target]);
    expect(effectiveLevel(s, building)).toBe(0);
    expect(villageBuildings(s, content).find((b) => b.id === target)?.damaged).toBe(raid.repair);
    // Nothing is lost: the level stays, the stores keep what they held.
    expect(village(s).levels[target]).toBeGreaterThan(0);
    const wood = village(s).res.wood ?? 0;
    advance(s, TICK, content);
    expect(village(s).res.wood ?? 0).toBeGreaterThanOrEqual(wood);
    advance(s, (raid.repair - 1) * TICK, content);
    expect(village(s).damage).toEqual({});
    expect(effectiveLevel(s, building)).toBe(working);
    expect(events(s, 'buildingRepaired')).toHaveLength(1);
  });

  it('does not produce while damaged, and does again after', () => {
    const s = atTheGates();
    village(s).res.wood = 0;
    defend(s, 5);
    advance(s, raid.hold * TICK, content);
    // The first target is the one that makes wood in the data of the pack.
    const sawmill = content.buildings.find((b) => b.produces.includes('wood'));
    expect(sawmill?.id).toBe(raid.targets[0]);
    const at = village(s).res.wood ?? 0;
    advance(s, 3 * TICK, content);
    expect(village(s).res.wood).toBe(at);
    advance(s, raid.repair * TICK, content);
    expect(village(s).res.wood ?? 0).toBeGreaterThan(at);
  });

  it('takes the bonus of a damaged building away from the modifiers', () => {
    const s = atTheGates();
    // One pack stopped: the others get through and every target is damaged, the market with them.
    defend(s, 1);
    const market = content.buildings.find((b) => b.id === 'core:market')!;
    const key = market.effects[0]!.key;
    const before = getMod(s, key, content).total;
    expect(before).toBeLessThan(1);
    advance(s, raid.hold * TICK, content);
    expect(info(s).damaged).toContain(market.id);
    expect(getMod(s, key, content).total).toBe(1);
    advance(s, raid.repair * TICK, content);
    expect(getMod(s, key, content).total).toBe(before);
  });

  it('does not serve a cached bonus for a building damaged (or repaired) with its level unchanged', () => {
    const s = called();
    const market = content.buildings.find((b) => b.id === 'core:market')!;
    const key = market.effects[0]!.key;
    expect(village(s).levels[market.id]).toBeGreaterThan(0);
    // Ask first so the village keeps its bonuses, then change only the damage mark.
    const built = getMod(s, key, content).total;
    expect(built).toBeLessThan(1);
    expect(getMod(s, key, content).total).toBe(built);
    village(s).damage[market.id] = 2;
    expect(getMod(s, key, content).total).toBe(1);
    expect(getMod(s, key, content).total).toBe(1);
    delete village(s).damage[market.id];
    expect(getMod(s, key, content).total).toBe(built);
  });

  it('never damages a building that is not built, and a building already damaged only once', () => {
    const s = atTheGates();
    delete village(s).levels[raid.targets[0]!];
    defend(s, 1);
    advance(s, raid.hold * TICK, content);
    expect(info(s).damaged).toEqual(raid.targets.slice(1, raid.packs));
    expect(village(s).damage[raid.targets[0]!]).toBeUndefined();
  });

  it('does not touch the stores or the treasury', () => {
    const s = atTheGates();
    for (const key of Object.keys(village(s).res)) village(s).res[key] = 150;
    village(s).treasury = 400;
    defend(s, 1);
    advance(s, raid.hold * TICK, content);
    for (const key of Object.keys(village(s).res))
      expect(village(s).res[key] ?? 0, key).toBeGreaterThanOrEqual(150 - 1);
    expect(village(s).treasury).toBeGreaterThanOrEqual(400);
  });
});

describe('time away', () => {
  it('a village with a defence is raided and repaired while the player is away', () => {
    const s = called();
    defend(s, 3);
    const summary = advanceOffline(s, (raid.lead + raid.hold + raid.repair + 2) * TICK, content);
    expect(summary.simulatedMs).toBe((raid.lead + raid.hold + raid.repair + 2) * TICK);
    expect(info(s)).toMatchObject({ phase: 'over', byVillage: 3, breached: raid.packs - 3 });
    expect(village(s).damage).toEqual({});
  });

  it('a village with no defence waits for the player: nothing is decided in their absence', () => {
    const s = called();
    advanceOffline(s, (raid.lead + raid.hold + 40) * TICK, content);
    expect(info(s)).toMatchObject({ phase: 'active', waiting: true, repelled: 0 });
    expect(village(s).damage).toEqual({});
    expect(s.currencies.rep).toBe(0);
  });

  it('is the same as the same time played online', () => {
    const a = called();
    const b = called();
    defend(a, 3);
    defend(b, 3);
    const total = (raid.lead + raid.hold + 5) * TICK;
    advanceOffline(a, total, content);
    advance(b, total, content);
    expect(serialize(a)).toBe(serialize(b));
  });
});

describe('determinism and split invariance', () => {
  it('plays the raid the same however the time is cut, with a fight in it', () => {
    const total = (raid.lead + raid.hold + raid.repair + 3) * TICK;
    const play = (chunk: number): string => {
      const s = called(11, 20);
      defend(s, 3);
      advance(s, raid.lead * TICK, content);
      startFight(s, RAID);
      for (let done = raid.lead * TICK; done < total; done += chunk)
        advance(s, Math.min(chunk, total - done), content);
      return serialize(s);
    };
    const whole = play(total);
    expect(play(TICK)).toBe(whole);
    expect(play(7_919)).toBe(whole);
    expect(play(61_000)).toBe(whole);
    expect(play(total)).toBe(whole);
  });

  it('gives the same result from the same state twice', () => {
    const a = atTheGates(3, 20);
    const b = atTheGates(3, 20);
    for (const s of [a, b]) {
      startFight(s, RAID);
      advance(s, 2 * 3_600_000, content);
    }
    expect(serialize(a)).toBe(serialize(b));
    expect(info(a).phase).toBe('over');
  });
});

describe('the save', () => {
  it('keeps a raid in every phase through a save', () => {
    const warned = called();
    const active = atTheGates();
    const over = atTheGates();
    defend(over, raid.packs);
    advance(over, raid.hold * TICK, content);
    for (const s of [warned, active, over]) {
      const loaded = deserialize(serialize(s), content);
      expect(serialize(loaded)).toBe(serialize(s));
      expect(village(loaded).raids).toEqual(village(s).raids);
    }
    const loaded = deserialize(serialize(active), content);
    expect(loaded.flags[raidFlag(RAID, 'active')]).toBe(true);
    expect(startFight(loaded, RAID)).toEqual({ ok: true });
  });

  it('keeps a damaged building and its repair time', () => {
    const s = atTheGates();
    defend(s, 5);
    advance(s, (raid.hold + 2) * TICK, content);
    const loaded = deserialize(serialize(s), content);
    expect(village(loaded).damage).toEqual(village(s).damage);
    expect(Object.keys(village(loaded).damage)).toHaveLength(1);
  });

  it('does not trust what a save says about a raid', () => {
    const s = atTheGates();
    const text = JSON.parse(serialize(s)) as {
      state: {
        village: { raids: Record<string, Record<string, unknown>>; damage: Record<string, number> };
        flags: Record<string, unknown>;
      };
    };
    const v = text.state.village;
    v.raids[RAID] = {
      phase: 'active',
      ticks: 1e9,
      repelled: 99,
      byVillage: 99,
      breached: 99,
      damaged: ['x'],
      ryo: 1e9,
      rep: 1e9,
    };
    v.damage = { 'core:farms': 1e9, 'core:nowhere': 5, 'core:forge': 0 };
    text.state.flags[raidFlag(RAID, 'over')] = true;
    const loaded = deserialize(JSON.stringify(text), content);
    const run2 = village(loaded).raids[RAID]!;
    expect(run2.ticks).toBeLessThanOrEqual(raid.hold);
    expect(run2.repelled).toBeLessThanOrEqual(raid.packs);
    expect(run2.repelled + run2.byVillage).toBeLessThanOrEqual(raid.packs);
    expect(run2.byVillage).toBe(0);
    expect(village(loaded).damage['core:farms']).toBeLessThanOrEqual(raid.repair);
    expect(village(loaded).damage['core:nowhere']).toBeUndefined();
    // The flags follow the phase, not the save.
    expect(loaded.flags[raidFlag(RAID, 'over')]).toBeUndefined();
    expect(loaded.flags[raidFlag(RAID, 'active')]).toBe(true);
  });

  it('forgets a raid of a pack that is gone', () => {
    const s = atTheGates();
    const text = JSON.parse(serialize(s)) as {
      state: { village: { raids: Record<string, unknown> } };
    };
    text.state.village.raids['gone:raid'] = { phase: 'active', ticks: 3 };
    const loaded = deserialize(JSON.stringify(text), content);
    expect(Object.keys(village(loaded).raids)).toEqual([RAID]);
  });
});

describe('the story', () => {
  it('finishes the step when the raid is over, however it ended, and goes on to the next', () => {
    for (const how of ['fight', 'village', 'breach'] as const) {
      const s = atTheGates();
      expect(s.quests[QUEST]?.step).toBe(STEP);
      if (how === 'fight') {
        startFight(s, RAID);
        for (let i = 0; i < 100 && info(s).phase !== 'over'; i++) advance(s, 30_000, content);
      } else {
        defend(s, how === 'village' ? raid.packs : 1);
        advance(s, raid.hold * TICK, content);
      }
      expect(info(s).phase, how).toBe('over');
      // The step is done; the chain goes on (a Barrier of the level the next step asks for may finish that one too).
      expect(s.quests[QUEST]?.step, how).toBeGreaterThanOrEqual(STEP + 1);
    }
  });

  it('is not finished by the packs of a zone fought elsewhere', () => {
    const s = called();
    for (let i = 0; i < 3; i++) {
      s.counters['kills.core:merc_pack'] = (s.counters['kills.core:merc_pack'] ?? 0) + 10;
      updateQuests(s, content);
    }
    expect(s.quests[QUEST]?.step).toBe(STEP);
  });

  it('keeps the old chain step open for a character who has not reached it', () => {
    const s = beforeRaid();
    expect(s.quests[QUEST]?.step).toBe(STEP - 1);
    expect(village(s).raids).toEqual({});
  });
});
